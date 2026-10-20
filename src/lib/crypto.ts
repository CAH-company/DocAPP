import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Transform, type TransformCallback } from "node:stream";

// Szyfrowanie envelope (SECURITY_RODO §4.2-4.3):
//   KEK (MASTER_KEY) -> owija losowy DEK (AES-256-GCM) -> DEK szyfruje dane.
// Każda wartość/plik zapisuje key_id, więc rotacja KEK to przeszyfrowanie samych DEK-ów.

export interface Keyring {
  currentId: string;
  keys: Map<string, Buffer>;
}

export function buildKeyring(currentId: string, currentHex: string, previous?: string): Keyring {
  const keys = new Map<string, Buffer>([[currentId, Buffer.from(currentHex, "hex")]]);
  for (const part of (previous ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    const [id, hex] = part.split(":");
    if (!id || !hex || !/^[0-9a-f]{64}$/i.test(hex)) throw new Error("MASTER_KEYS_PREVIOUS: oczekiwany format id:hex64[,id:hex64]");
    if (keys.has(id)) throw new Error("MASTER_KEYS_PREVIOUS: duplikat identyfikatora klucza");
    keys.set(id, Buffer.from(hex, "hex"));
  }
  for (const k of keys.values()) if (k.length !== 32) throw new Error("Klucz musi mieć 32 bajty");
  return { currentId, keys };
}

function kek(ring: Keyring, id: string): Buffer {
  const k = ring.keys.get(id);
  if (!k) throw new Error(`Brak klucza ${id} (rotacja? sprawdź MASTER_KEYS_PREVIOUS)`);
  return k;
}

// --- Owijanie DEK ---------------------------------------------------------------------------
function wrapKey(ring: Keyring, dek: Buffer): { keyId: string; wrapped: Buffer } {
  const keyId = ring.currentId;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", kek(ring, keyId), iv);
  c.setAAD(Buffer.from(keyId));
  const ct = Buffer.concat([c.update(dek), c.final()]);
  return { keyId, wrapped: Buffer.concat([iv, c.getAuthTag(), ct]) }; // 12 + 16 + 32
}

function unwrapKey(ring: Keyring, keyId: string, wrapped: Buffer): Buffer {
  const d = createDecipheriv("aes-256-gcm", kek(ring, keyId), wrapped.subarray(0, 12));
  d.setAAD(Buffer.from(keyId));
  d.setAuthTag(wrapped.subarray(12, 28));
  return Buffer.concat([d.update(wrapped.subarray(28)), d.final()]);
}

// --- Pola (np. numer konta) ------------------------------------------------------------------
// Format: v1.<keyId>.<wrappedDEK b64url>.<iv>.<tag>.<ciphertext>
const b64 = (b: Buffer) => b.toString("base64url");

export function encryptField(ring: Keyring, plaintext: string, aad = ""): string {
  const dek = randomBytes(32);
  const { keyId, wrapped } = wrapKey(ring, dek);
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dek, iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return ["v1", keyId, b64(wrapped), b64(iv), b64(c.getAuthTag()), b64(ct)].join(".");
}

/** `aad` wiąże szyfrogram z kontekstem (np. user id), więc nie da się go podmienić między wierszami. */
export function decryptField(ring: Keyring, value: string, aad = ""): string {
  const [v, keyId, wrapped, iv, tag, ct] = value.split(".");
  if (v !== "v1" || !keyId || !wrapped || !iv || !tag || ct === undefined) throw new Error("Nieprawidłowy format szyfrogramu");
  const dek = unwrapKey(ring, keyId, Buffer.from(wrapped, "base64url"));
  const d = createDecipheriv("aes-256-gcm", dek, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(aad));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export function fieldKeyId(value: string): string | undefined {
  return value.split(".")[1];
}

/** Przeszyfrowanie samego DEK nowym KEK-iem (rotacja), bez dotykania danych. */
export function rewrapField(ring: Keyring, value: string): string {
  const [v, keyId, wrapped, ...rest] = value.split(".");
  if (v !== "v1" || !keyId || !wrapped) throw new Error("Nieprawidłowy format szyfrogramu");
  const dek = unwrapKey(ring, keyId, Buffer.from(wrapped, "base64url"));
  const next = wrapKey(ring, dek);
  return ["v1", next.keyId, b64(next.wrapped), ...rest].join(".");
}

// --- Pliki: strumieniowe AEAD porcjami (STREAM) ----------------------------------------------
// Układ: "ORF1" | idLen(1) | keyId | wrappedDEK(60) | noncePrefix(4) | porcje...
// Porcja = AES-256-GCM(plain ≤ 64 KiB) + tag(16); nonce = prefix(4) || licznik(8, BE);
// AAD = 1 bajt "ostatnia porcja". Dzięki temu odczyt jest uwierzytelniany na bieżąco
// (nie oddajemy niezweryfikowanych danych) i ucięcie pliku jest wykrywane.
const MAGIC = Buffer.from("ORF1");
export const CHUNK = 64 * 1024;
const TAG = 16;
const WRAPPED_LEN = 60; // iv 12 + tag 16 + DEK 32

function nonce(prefix: Buffer, counter: number): Buffer {
  const n = Buffer.alloc(12);
  prefix.copy(n, 0);
  n.writeBigUInt64BE(BigInt(counter), 4);
  return n;
}

function sealChunk(dek: Buffer, prefix: Buffer, counter: number, last: boolean, plain: Buffer): Buffer {
  const c = createCipheriv("aes-256-gcm", dek, nonce(prefix, counter));
  c.setAAD(Buffer.from([last ? 1 : 0]));
  return Buffer.concat([c.update(plain), c.final(), c.getAuthTag()]);
}

export function createEncryptStream(ring: Keyring): { stream: Transform; keyId: string } {
  const dek = randomBytes(32);
  const { keyId, wrapped } = wrapKey(ring, dek);
  const prefix = randomBytes(4);
  let counter = 0;
  let pending = Buffer.alloc(0);
  let headerSent = false;

  const header = () => {
    headerSent = true;
    return Buffer.concat([MAGIC, Buffer.from([keyId.length]), Buffer.from(keyId), wrapped, prefix]);
  };

  const stream = new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      if (!headerSent) this.push(header());
      pending = Buffer.concat([pending, chunk]);
      // Zawsze zostawiamy ≥ 1 bajt na ostatnią porcję (z flagą "last").
      while (pending.length > CHUNK) {
        this.push(sealChunk(dek, prefix, counter++, false, pending.subarray(0, CHUNK)));
        pending = pending.subarray(CHUNK);
      }
      cb();
    },
    flush(cb: TransformCallback) {
      if (!headerSent) this.push(header());
      this.push(sealChunk(dek, prefix, counter++, true, pending));
      cb();
    },
  });
  return { stream, keyId };
}

export function createDecryptStream(ring: Keyring): Transform {
  let buf = Buffer.alloc(0);
  let state: { dek: Buffer; prefix: Buffer } | undefined;
  let counter = 0;

  const open = (frame: Buffer, last: boolean): Buffer => {
    const s = state!;
    const d = createDecipheriv("aes-256-gcm", s.dek, nonce(s.prefix, counter++));
    d.setAAD(Buffer.from([last ? 1 : 0]));
    d.setAuthTag(frame.subarray(frame.length - TAG));
    return Buffer.concat([d.update(frame.subarray(0, frame.length - TAG)), d.final()]);
  };

  const parseHeader = (): boolean => {
    if (buf.length < 5) return false;
    if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error("Nieprawidłowy nagłówek pliku");
    const idLen = buf[4]!;
    const total = 5 + idLen + WRAPPED_LEN + 4;
    if (buf.length < total) return false;
    const keyId = buf.subarray(5, 5 + idLen).toString();
    const wrapped = buf.subarray(5 + idLen, 5 + idLen + WRAPPED_LEN);
    state = { dek: unwrapKey(ring, keyId, wrapped), prefix: buf.subarray(total - 4, total) };
    buf = buf.subarray(total);
    return true;
  };

  return new Transform({
    transform(chunk: Buffer, _enc, cb: TransformCallback) {
      try {
        buf = Buffer.concat([buf, chunk]);
        if (!state && !parseHeader()) return cb();
        // Porcja jest nie-ostatnia tylko wtedy, gdy za nią są jeszcze dane (≥ 1 bajt kolejnej porcji).
        while (buf.length > CHUNK + TAG) {
          this.push(open(buf.subarray(0, CHUNK + TAG), false));
          buf = buf.subarray(CHUNK + TAG);
        }
        cb();
      } catch (e) {
        cb(e as Error);
      }
    },
    flush(cb: TransformCallback) {
      try {
        if (!state) throw new Error("Plik jest ucięty");
        if (buf.length < TAG) throw new Error("Plik jest ucięty");
        this.push(open(buf, true));
        cb();
      } catch (e) {
        cb(e as Error);
      }
    },
  });
}
