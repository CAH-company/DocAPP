import { connect } from "node:net";
import type { Readable } from "node:stream";
import { getEnv } from "../env";

export type ScanResult = { clean: true } | { clean: false; signature: string };

export class ScannerUnavailableError extends Error {
  constructor(reason: string) {
    super(`Skaner antywirusowy niedostępny: ${reason}`);
  }
}

export interface Scanner {
  scan(data: Readable): Promise<ScanResult>;
}

/** Klient clamd (protokół zINSTREAM). Każdy błąd łączności = brak decyzji = odrzucenie uploadu (fail closed). */
export class ClamdScanner implements Scanner {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs = 60_000,
  ) {}

  scan(data: Readable): Promise<ScanResult> {
    return new Promise((resolve, reject) => {
      const sock = connect({ host: this.host, port: this.port });
      const response: Buffer[] = [];
      let settled = false;
      const fail = (e: Error) => {
        if (settled) return;
        settled = true;
        sock.destroy();
        data.destroy();
        reject(e instanceof ScannerUnavailableError ? e : new ScannerUnavailableError(e.message));
      };
      sock.setTimeout(this.timeoutMs, () => fail(new Error("przekroczono czas")));
      sock.on("error", fail);
      sock.on("data", (c) => response.push(c));
      sock.on("close", () => {
        if (settled) return;
        settled = true;
        const text = Buffer.concat(response).toString().replace(/\0/g, "").trim();
        if (/OK$/.test(text) && !/FOUND|ERROR/.test(text)) return resolve({ clean: true });
        const m = text.match(/^stream: (.+) FOUND$/);
        if (m) return resolve({ clean: false, signature: m[1]! });
        reject(new ScannerUnavailableError(`nieoczekiwana odpowiedź: ${text.slice(0, 80) || "(pusta)"}`));
      });
      sock.on("connect", async () => {
        try {
          sock.write("zINSTREAM\0");
          for await (const chunk of data) {
            const buf = chunk as Buffer;
            // clamd przyjmuje porcje z 4-bajtowym nagłówkiem długości (BE); limit porcji ustawia StreamMaxLength.
            for (let i = 0; i < buf.length; i += 65536) {
              const part = buf.subarray(i, i + 65536);
              const len = Buffer.alloc(4);
              len.writeUInt32BE(part.length);
              if (!sock.write(Buffer.concat([len, part]))) await new Promise((r) => sock.once("drain", r));
            }
          }
          sock.write(Buffer.alloc(4)); // koniec strumienia
        } catch (e) {
          fail(e as Error);
        }
      });
    });
  }
}

let scanner: Scanner | undefined;
export function getScanner(): Scanner {
  if (!scanner) {
    const env = getEnv();
    scanner = new ClamdScanner(env.CLAMAV_HOST, env.CLAMAV_PORT);
  }
  return scanner;
}

/** Tylko testy. */
export function __setScannerForTests(s: Scanner | undefined) {
  scanner = s;
}
