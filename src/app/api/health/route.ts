import { NextResponse } from "next/server";
import { getSql } from "@/db/client";

export const dynamic = "force-dynamic";

// Zwraca wyłącznie status techniczny, bez danych osobowych.
export async function GET() {
  try {
    await getSql()`select 1`;
    return NextResponse.json({ status: "ok", version: process.env.APP_VERSION ?? "dev" });
  } catch {
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
}
