import { randomBytes } from "node:crypto";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import {
  buildKeyring,
  CHUNK,
  createDecryptStream,
  createEncryptStream,
  decryptField,
  encryptField,
  fieldKeyId,
  rewrapField,
} from "@/lib/crypto";

const ring = buildKeyring("k1", "11".repeat(32));

async function collect(src: Readable, ...t: NodeJS.ReadWriteStream[]): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const sink = async (s: AsyncIterable<Buffer>) => {
    for await (const c of s) chunks.push(c);
  };
  await (pipeline as unknown as (...streams: unknown[]) => Promise<void>)(src, ...t, sink);
  return Buffer.concat(chunks);
}

const encrypt = (data: Buffer, r = ring) => collect(Readable.from([data]), createEncryptStream(r).stream);
const decrypt = (data: Buffer, r = ring) => collect(Readable.from([data]), createDecryptStream(r));

describe("szyfrowanie pól", () => {
  it("odszyfrowuje to, co zaszyfrowano; szyfrogram nie zawiera tekstu jawnego", () => {
    const enc = encryptField(ring, "PL61109010140000071219812874", "user-1");
    expect(enc).not.toContain("PL61");
    expect(fieldKeyId(enc)).toBe("k1");
    expect(decryptField(ring, enc, "user-1")).toBe("PL61109010140000071219812874");
  });

  it("szyfrogram przeniesiony do innego kontekstu (AAD) nie otwiera się", () => {
    const enc = encryptField(ring, "tajne", "user-1");
    expect(() => decryptField(ring, enc, "user-2")).toThrow();
  });

  it("modyfikacja szyfrogramu jest wykrywana", () => {
    const enc = encryptField(ring, "tajne");
    const parts = enc.split(".");
    parts[5] = Buffer.from("zmienione").toString("base64url");
    expect(() => decryptField(ring, parts.join("."))).toThrow();
  });

  it("zły klucz nie odszyfruje", () => {
    const enc = encryptField(ring, "tajne");
    expect(() => decryptField(buildKeyring("k1", "22".repeat(32)), enc)).toThrow();
  });

  it("rotacja: przeszyfrowanie DEK nowym kluczem, stary klucz nadal czyta stare dane", () => {
    const enc = encryptField(ring, "tajne");
    const ring2 = buildKeyring("k2", "22".repeat(32), `k1:${"11".repeat(32)}`);
    expect(decryptField(ring2, enc)).toBe("tajne");
    const rewrapped = rewrapField(ring2, enc);
    expect(fieldKeyId(rewrapped)).toBe("k2");
    // po rotacji wystarczy sam nowy klucz
    expect(decryptField(buildKeyring("k2", "22".repeat(32)), rewrapped)).toBe("tajne");
  });
});

describe("szyfrowanie plików (strumień)", () => {
  const sizes = [0, 1, 100, CHUNK - 1, CHUNK, CHUNK + 1, CHUNK * 3, CHUNK * 3 + 17];
  for (const size of sizes) {
    it(`round-trip ${size} B`, async () => {
      const data = randomBytes(size);
      const enc = await encrypt(data);
      expect(enc.subarray(0, 4).toString()).toBe("ORF1");
      expect((await decrypt(enc)).equals(data)).toBe(true);
    });
  }

  it("surowy plik na dysku nie jest czytelnym PDF", async () => {
    const pdf = Buffer.from("%PDF-1.7\n" + "treść dokumentu ".repeat(1000));
    const enc = await encrypt(pdf);
    expect(enc.includes(Buffer.from("%PDF-"))).toBe(false);
    expect(enc.includes(Buffer.from("treść dokumentu"))).toBe(false);
  });

  it("dwa szyfrowania tego samego pliku dają różne wyniki (losowy DEK i nonce)", async () => {
    const data = randomBytes(1000);
    expect((await encrypt(data)).equals(await encrypt(data))).toBe(false);
  });

  it("bit-flip w środku jest wykrywany", async () => {
    const enc = await encrypt(randomBytes(CHUNK * 2));
    enc[enc.length >> 1]! ^= 1;
    await expect(decrypt(enc)).rejects.toThrow();
  });

  it("ucięcie pliku na granicy porcji jest wykrywane", async () => {
    const enc = await encrypt(randomBytes(CHUNK * 3));
    const headerLen = 5 + 2 + 60 + 4;
    const cut = enc.subarray(0, headerLen + (CHUNK + 16) * 2); // dwie pełne porcje, bez ostatniej
    await expect(decrypt(cut)).rejects.toThrow();
  });

  it("zamiana kolejności porcji jest wykrywana", async () => {
    const enc = await encrypt(randomBytes(CHUNK * 3));
    const h = 5 + 2 + 60 + 4;
    const f = CHUNK + 16;
    const swapped = Buffer.concat([enc.subarray(0, h), enc.subarray(h + f, h + 2 * f), enc.subarray(h, h + f), enc.subarray(h + 2 * f)]);
    await expect(decrypt(swapped)).rejects.toThrow();
  });

  it("zły klucz główny nie odszyfruje pliku", async () => {
    const enc = await encrypt(Buffer.from("tajne"));
    await expect(decrypt(enc, buildKeyring("k1", "33".repeat(32)))).rejects.toThrow();
  });

  it("odszyfrowanie działa dla danych podawanych w małych kawałkach", async () => {
    const data = randomBytes(CHUNK * 2 + 5);
    const enc = await encrypt(data);
    const pieces: Buffer[] = [];
    for (let i = 0; i < enc.length; i += 1000) pieces.push(enc.subarray(i, i + 1000));
    const out = await collect(Readable.from(pieces), createDecryptStream(ring));
    expect(out.equals(data)).toBe(true);
  });
});
