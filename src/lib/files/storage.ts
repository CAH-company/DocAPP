import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getEnv } from "../env";

/** Magazyn przechowuje wyłącznie szyfrogramy pod losowymi kluczami (UUID); oryginalna nazwa jest tylko w bazie. */
export interface StorageDriver {
  put(key: string, data: Readable): Promise<void>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function assertKey(key: string): void {
  if (!KEY_RE.test(key)) throw new Error("Nieprawidłowy klucz magazynu");
}

export class LocalStorageDriver implements StorageDriver {
  constructor(private readonly root: string) {}

  // Podkatalog po pierwszych 2 znakach, żeby nie trzymać wszystkiego w jednym folderze.
  private path(key: string): string {
    assertKey(key);
    return join(this.root, key.slice(0, 2), key);
  }

  async put(key: string, data: Readable): Promise<void> {
    const final = this.path(key);
    const tmp = `${final}.${process.pid}.tmp`;
    await mkdir(dirname(final), { recursive: true, mode: 0o700 });
    try {
      await pipeline(data, createWriteStream(tmp, { mode: 0o600, flags: "wx" }));
      await rename(tmp, final);
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  async get(key: string): Promise<Readable> {
    const p = this.path(key);
    await stat(p); // błąd ENOENT przed rozpoczęciem odpowiedzi
    return createReadStream(p);
  }

  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.path(key));
      return true;
    } catch {
      return false;
    }
  }
}

export class S3StorageDriver implements StorageDriver {
  private clientPromise?: Promise<import("@aws-sdk/client-s3").S3Client>;

  constructor(
    private readonly cfg: { endpoint?: string; bucket: string; region: string; accessKeyId: string; secretAccessKey: string; forcePathStyle: boolean },
  ) {}

  private async client() {
    this.clientPromise ??= import("@aws-sdk/client-s3").then(
      ({ S3Client }) =>
        new S3Client({
          endpoint: this.cfg.endpoint,
          region: this.cfg.region,
          forcePathStyle: this.cfg.forcePathStyle,
          credentials: { accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey },
        }),
    );
    return this.clientPromise;
  }

  async put(key: string, data: Readable): Promise<void> {
    assertKey(key);
    const { Upload } = await import("@aws-sdk/lib-storage");
    await new Upload({ client: await this.client(), params: { Bucket: this.cfg.bucket, Key: key, Body: data, ServerSideEncryption: "AES256" } }).done();
  }

  async get(key: string): Promise<Readable> {
    assertKey(key);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await (await this.client()).send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
    if (!(res.Body instanceof Readable)) throw new Error("Pusta odpowiedź magazynu");
    return res.Body;
  }

  async delete(key: string): Promise<void> {
    assertKey(key);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await (await this.client()).send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    assertKey(key);
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      await (await this.client()).send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

let driver: StorageDriver | undefined;
export function getStorage(): StorageDriver {
  if (driver) return driver;
  const env = getEnv();
  driver =
    env.STORAGE_DRIVER === "s3"
      ? new S3StorageDriver({
          endpoint: env.S3_ENDPOINT,
          bucket: env.S3_BUCKET!,
          region: env.S3_REGION,
          accessKeyId: env.S3_ACCESS_KEY_ID!,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
          forcePathStyle: env.S3_FORCE_PATH_STYLE,
        })
      : new LocalStorageDriver(env.STORAGE_LOCAL_PATH);
  return driver;
}

/** Tylko testy. */
export function __setStorageForTests(d: StorageDriver | undefined) {
  driver = d;
}
