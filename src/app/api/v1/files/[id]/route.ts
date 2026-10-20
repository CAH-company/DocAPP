import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, errorResponse, sameOriginOk } from "@/lib/http";
import { safeFilename } from "@/lib/files/types";
import { getAuthContext } from "@/lib/session";
import { deleteFile, openFile } from "@/server/files";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const notFound = () => NextResponse.json({ error: "not_found" }, { status: 404 });

// GET /api/v1/files/:id[?inline=1]  — odszyfrowanie w locie, po kontroli uprawnień (RLS + authz)
export async function GET(req: Request, { params }: Params) {
  const ctx = await getAuthContext();
  if (!ctx || ctx.needs2faSetup) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return notFound();

  try {
    const wantInline = new URL(req.url).searchParams.get("inline") === "1";
    const file = await openFile(ctx, id.data, clientIp(req), wantInline);
    if (!file) return notFound(); // brak pliku i brak dostępu wyglądają tak samo
    const name = safeFilename(file.originalName);
    const headers: Record<string, string> = {
      "Content-Type": file.mime,
      // Tylko PDF w podglądzie; reszta zawsze jako pobranie (SECURITY_RODO §7).
      "Content-Disposition": `${file.inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Length": String(file.sizeBytes),
    };
    if (!file.inline) headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
    return new Response(Readable.toWeb(file.stream) as ReadableStream, { headers });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request, { params }: Params) {
  if (!sameOriginOk(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const ctx = await getAuthContext();
  if (!ctx || ctx.needs2faSetup) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return notFound();
  try {
    return (await deleteFile(ctx, id.data, clientIp(req))) ? new NextResponse(null, { status: 204 }) : notFound();
  } catch (err) {
    return errorResponse(err);
  }
}
