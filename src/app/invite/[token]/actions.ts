"use server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { acceptInvitation, InviteError } from "@/server/invitations";

export type ActionState = { error: string | null };

export async function acceptInvitationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    await acceptInvitation(
      {
        token: form.get("token"),
        password: form.get("password"),
        clauseAccepted: form.get("clauseAccepted") === "on",
      },
      ip,
    );
  } catch (err) {
    if (err instanceof InviteError) return { error: "Zaproszenie wygasło lub zostało już wykorzystane." };
    if (err instanceof ZodError) return { error: "Hasło musi mieć co najmniej 12 znaków, a klauzula musi być zaakceptowana." };
    throw err;
  }
  redirect("/login");
}
