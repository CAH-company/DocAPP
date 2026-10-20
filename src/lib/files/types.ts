// Whitelista typów: MIME + rozszerzenie + magic bytes muszą być spójne (SECURITY_RODO §7).
export type FileKind = "pdf" | "png" | "jpg" | "docx";

interface KindSpec {
  mime: string;
  ext: string[];
  magic: (head: Buffer) => boolean;
  /** Czy przeglądarka może wyświetlić plik w podglądzie (tylko PDF). */
  inline: boolean;
}

export const KINDS: Record<FileKind, KindSpec> = {
  pdf: { mime: "application/pdf", ext: [".pdf"], magic: (h) => h.subarray(0, 5).toString("latin1") === "%PDF-", inline: true },
  png: { mime: "image/png", ext: [".png"], magic: (h) => h.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), inline: false },
  jpg: { mime: "image/jpeg", ext: [".jpg", ".jpeg"], magic: (h) => h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff, inline: false },
  // DOCX to ZIP; w F1 nie jest renderowany, tylko pobierany.
  docx: {
    mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ext: [".docx"],
    magic: (h) => h[0] === 0x50 && h[1] === 0x4b && h[2] === 0x03 && h[3] === 0x04,
    inline: false,
  },
};

export const DEMO_KINDS: FileKind[] = ["pdf", "png", "jpg"];
export const PROD_KINDS: FileKind[] = ["pdf", "png", "jpg", "docx"];

export class FileRejectedError extends Error {
  constructor(public readonly reason: "type" | "size" | "empty" | "infected" | "related") {
    super(reason);
  }
}

/** Zwraca rodzaj pliku albo rzuca FileRejectedError("type"). Nie ufamy samemu deklarowanemu MIME. */
export function detectKind(head: Buffer, declaredMime: string, filename: string, allowed: FileKind[]): FileKind {
  const lower = filename.toLowerCase();
  for (const kind of allowed) {
    const spec = KINDS[kind];
    if (spec.magic(head) && spec.mime === declaredMime.toLowerCase() && spec.ext.some((e) => lower.endsWith(e))) return kind;
  }
  throw new FileRejectedError("type");
}

/** Nazwa pliku z bazy do nagłówka: bez ścieżek i znaków sterujących. */
export function safeFilename(name: string): string {
  const base = name.replace(/[\\/]/g, "_").replace(/[\u0000-\u001f\u007f"]/g, "").trim().slice(0, 150);
  return base || "plik";
}
