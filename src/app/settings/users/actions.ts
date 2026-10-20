"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { requireAuth } from "@/lib/session";
import { InviteError, inviteUser } from "@/server/invitations";

export type InviteState = { error: string | null; ok: boolean };

export async function inviteAction(_: InviteState, form: FormData): Promise<InviteState> {
  const ctx = await requireAuth("users.manage"); // sprawdzenie po stronie serwera, niezależnie od UI
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    await inviteUser(ctx, { email: form.get("email"), name: form.get("name"), role: form.get("role") }, ip);
  } catch (err) {
    if (err instanceof ZodError) return { error: "Sprawdź poprawność danych.", ok: false };
    if (err instanceof InviteError) return { error: "Nie można zaprosić tej osoby.", ok: false };
    throw err;
  }
  revalidatePath("/settings/users");
  return { error: null, ok: true };
}
