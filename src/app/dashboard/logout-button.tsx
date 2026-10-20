"use client";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { btn } from "@/components/ui";

export function LogoutButton() {
  const router = useRouter();
  return (
    <button
      className={btn}
      onClick={async () => {
        await authClient.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      Wyloguj
    </button>
  );
}
