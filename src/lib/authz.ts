// Jedyne miejsce definiujące uprawnienia ról (BRIEF §5). UI może ukrywać przyciski,
// ale decyzja zawsze zapada tutaj, po stronie serwera.
export const ROLES = ["admin", "member", "accountant", "contractor"] as const;
export type Role = (typeof ROLES)[number];

const matrix = {
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
} as const satisfies Record<string, readonly Role[]>;

export type Action = keyof typeof matrix;
export const ACTIONS = Object.keys(matrix) as Action[];

export function can(role: Role, action: Action): boolean {
  return (matrix[action] as readonly Role[]).includes(role);
}

export class ForbiddenError extends Error {
  constructor(public readonly action: Action) {
    super("forbidden");
  }
}

export function assertCan(role: Role, action: Action): void {
  if (!can(role, action)) throw new ForbiddenError(action);
}

/** Role, dla których 2FA jest obowiązkowe (SECURITY_RODO §5). */
export const TWO_FACTOR_REQUIRED: readonly Role[] = ["admin", "accountant"];
/** Bezczynność po której sesja wygasa (minuty); null = tylko limit bezwzględny. */
export const IDLE_TIMEOUT_MIN: Record<Role, number | null> = {
  admin: 30,
  accountant: 30,
  member: null,
  contractor: null,
};

/** Kogo dany użytkownik może zapraszać i z jaką rolą. */
export function canInviteRole(inviter: Role, target: Role): boolean {
  if (inviter === "admin") return true;
  if (inviter === "member") return target === "contractor";
  return false;
}
