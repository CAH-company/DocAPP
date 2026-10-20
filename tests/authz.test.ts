import { describe, expect, it } from "vitest";
import { ACTIONS, can, canInviteRole, ROLES, type Action, type Role } from "@/lib/authz";

// Macierz oczekiwań spisana niezależnie od implementacji. Każda nowa akcja musi tu trafić.
const expected: Record<Action, Role[]> = {
  "org.settings": ["admin"],
  "users.manage": ["admin"],
  "retention.manage": ["admin"],
  "audit.read": ["admin"],
  "data.erase": ["admin"],
  "contractors.read": ["admin", "member", "accountant"],
  "contractors.write": ["admin", "member"],
  "contractors.invite": ["admin", "member"],
  "contracts.read": ["admin", "member", "accountant", "contractor"],
  "contracts.write": ["admin", "member"],
  "contracts.accept": ["contractor"],
  "statements.read": ["admin", "member", "accountant", "contractor"],
  "statements.write": ["admin", "member", "contractor"],
  "bills.read": ["admin", "member", "accountant", "contractor"],
  "bills.write": ["admin", "member"],
  "bills.send": ["admin", "member"],
  "bills.respond": ["contractor"],
  "bills.approve": ["admin", "member"],
  "bills.export": ["admin", "accountant"],
  "files.read": ["admin", "member", "accountant", "contractor"],
  "files.upload": ["admin", "member", "contractor"],
  "files.delete": ["admin", "member"],
  "data.export_org": ["admin", "accountant"],
  "data.export_self": ["admin", "member", "accountant", "contractor"],
};

describe("macierz uprawnień", () => {
  it("pokrywa wszystkie akcje", () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(expected).sort());
  });

  for (const action of Object.keys(expected) as Action[]) {
    for (const role of ROLES) {
      it(`${role} ${expected[action].includes(role) ? "MOŻE" : "NIE MOŻE"} ${action}`, () => {
        expect(can(role, action)).toBe(expected[action].includes(role));
      });
    }
  }

  it("księgowa jest read-only poza eksportem", () => {
    const writes = ACTIONS.filter((a) => /\.(write|send|approve|accept|respond|upload|delete|invite|manage|settings|erase)$/.test(a));
    for (const a of writes) expect(can("accountant", a)).toBe(false);
  });

  it("member zaprasza tylko zleceniobiorców; admin każdego", () => {
    expect(canInviteRole("member", "contractor")).toBe(true);
    expect(canInviteRole("member", "admin")).toBe(false);
    expect(canInviteRole("member", "member")).toBe(false);
    expect(canInviteRole("admin", "accountant")).toBe(true);
    expect(canInviteRole("accountant", "contractor")).toBe(false);
    expect(canInviteRole("contractor", "contractor")).toBe(false);
  });
});
