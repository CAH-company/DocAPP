import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { clientIp, errorResponse, sameOriginOk } from "@/lib/http";
import { getAuthContext } from "@/lib/session";
import { uploadFile } from "@/server/files";

export const dynamic = "force-dynamic";

// POST /api/v1/files  (multipart: file, relatedType, relatedId?)
export async function POST(req: Request) {
  if (!sameOriginOk(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const ctx = await getAuthContext();
  if (!ctx || ctx.needs2faSetup) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Tani odrzut zanim zbuforujemy ciało: nagłówek + zapas na część multipart.
  const max = getEnv().MAX_UPLOAD_MB * 1024 * 1024;
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > max + 64 * 1024) return NextResponse.json({ error: "file_size" }, { status: 413 });

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const relatedId = form.get("relatedId");
    const saved = await uploadFile(
      ctx,
      file,
      { relatedType: form.get("relatedType"), relatedId: typeof relatedId === "string" && relatedId ? relatedId : undefined },
      clientIp(req),
    );
    return NextResponse.json({ id: saved.id, name: saved.originalName, mime: saved.mime, size: saved.sizeBytes, sha256: saved.sha256 }, { status: 201 });
  } catch (err) {
    return errorResponse(err);
  }
}
