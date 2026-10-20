import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Handler tworzony przy żądaniu, bo getAuth() wymaga zmiennych środowiskowych.
export function GET(req: Request) {
  return toNextJsHandler(getAuth()).GET(req);
}
export function POST(req: Request) {
  return toNextJsHandler(getAuth()).POST(req);
}
