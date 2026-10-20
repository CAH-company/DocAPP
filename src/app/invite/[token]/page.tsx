import { notFound } from "next/navigation";
import { Card } from "@/components/ui";
import { clauseHash, lookupInvitation, rodoClauseText } from "@/server/invitations";
import { AcceptForm } from "./accept-form";

export const dynamic = "force-dynamic";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Jedna odpowiedź dla tokenu nieistniejącego, zużytego i wygasłego.
  if (!(await lookupInvitation(token))) notFound();

  return (
    <Card title="Ustaw hasło i zaakceptuj zasady">
      <AcceptForm token={token} clause={rodoClauseText()} clauseHash={clauseHash()} />
    </Card>
  );
}
