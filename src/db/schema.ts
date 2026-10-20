import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  inet,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().default(sql`gen_random_uuid()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", ["admin", "member", "accountant", "contractor"]);
export const membershipStatusEnum = pgEnum("membership_status", ["invited", "active", "disabled"]);
export const userStatusEnum = pgEnum("user_status", ["active", "locked", "disabled"]);
export const rateTypeEnum = pgEnum("rate_type", ["hourly", "monthly", "fixed"]);
export const contractStatusEnum = pgEnum("contract_status", [
  "draft",
  "pending_acceptance",
  "active",
  "expired",
  "terminated",
]);
export const contractSourceEnum = pgEnum("contract_source", ["uploaded", "external"]);
export const billStatusEnum = pgEnum("bill_status", [
  "draft",
  "sent",
  "accepted",
  "approved",
  "rejected",
  "exported",
]);
export const scanStatusEnum = pgEnum("scan_status", ["pending", "clean", "infected", "skipped"]);
export const acceptanceSubjectEnum = pgEnum("acceptance_subject", ["contract", "bill", "statement"]);
export const jobStatusEnum = pgEnum("job_status", ["ok", "failed"]);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  nip: text("nip"),
  address: text("address"),
  // retencja, hours_entered_by, klauzula RODO itd.
  settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
  createdAt: createdAt(),
});

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    // Hasło (account.password) i sekret TOTP (two_factors.secret) trzyma Better Auth.
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    twoFactorEnabled: boolean("two_factor_enabled").notNull().default(false),
    status: userStatusEnum("status").notNull().default("active"),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_email_uq").on(sql`lower(${t.email})`)],
);

// --- Tabele Better Auth (nazwy pól zgodne z jego modelem) ---
export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    token: text("token").notNull().unique(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: id(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("accounts_user_idx").on(t.userId)],
);

export const verifications = pgTable("verifications", {
  id: id(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const twoFactors = pgTable(
  "two_factors",
  {
    id: id(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    verified: boolean("verified").notNull().default(true),
    failedVerificationCount: integer("failed_verification_count").notNull().default(0),
    lockedUntil: timestamp("locked_until", { withTimezone: true }),
  },
  (t) => [index("two_factors_user_idx").on(t.userId)],
);

export const rateLimits = pgTable("rate_limits", {
  id: id(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// Zaproszenia: w bazie tylko hash tokenu (SECURITY_RODO §4.4).
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    invitedBy: uuid("invited_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [index("invitations_org_idx").on(t.orgId)],
);

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    role: roleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("invited"),
    invitedBy: uuid("invited_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

export const contractorProfiles = pgTable(
  "contractor_profiles",
  {
    userId: uuid("user_id").notNull().references(() => users.id),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    address: text("address"),
    bankAccountEnc: text("bank_account_enc"),
    bankAccountLast4: text("bank_account_last4"),
    birthDate: date("birth_date"),
    // PESEL: nie zbieramy w F1 (SECURITY_RODO §3). Kolumna powstanie dopiero przy FEATURE_PESEL.
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

export const files = pgTable(
  "files",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    ownerUserId: uuid("owner_user_id").references(() => users.id),
    relatedType: text("related_type").notNull(),
    relatedId: uuid("related_id"),
    originalName: text("original_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    sha256Plain: text("sha256_plain").notNull(),
    storageKey: text("storage_key").notNull(),
    keyId: text("key_id").notNull(),
    encryptionAlg: text("encryption_alg").notNull().default("AES-256-GCM"),
    scanStatus: scanStatusEnum("scan_status").notNull().default("pending"),
    uploadedBy: uuid("uploaded_by").references(() => users.id),
    createdAt: createdAt(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("files_org_related_idx").on(t.orgId, t.relatedType, t.relatedId)],
);

export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    contractorId: uuid("contractor_id").notNull().references(() => users.id),
    number: text("number").notNull(),
    title: text("title").notNull(),
    scope: text("scope"),
    rateType: rateTypeEnum("rate_type").notNull(),
    rateAmountGross: numeric("rate_amount_gross", { precision: 12, scale: 2 }).notNull(),
    currency: text("currency").notNull().default("PLN"),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    status: contractStatusEnum("status").notNull().default("draft"),
    source: contractSourceEnum("source").notNull().default("external"),
    fileId: uuid("file_id").references(() => files.id),
    acceptedByContractorAt: timestamp("accepted_by_contractor_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("contracts_org_number_uq").on(t.orgId, t.number),
    index("contracts_org_contractor_idx").on(t.orgId, t.contractorId),
    index("contracts_org_end_idx").on(t.orgId, t.endDate),
  ],
);

export const contractStatements = pgTable("contract_statements", {
  id: id(),
  contractId: uuid("contract_id").notNull().references(() => contracts.id),
  validFrom: date("valid_from").notNull(),
  isStudentUnder26: boolean("is_student_under_26").notNull().default(false),
  studentStatusValidUntil: date("student_status_valid_until"),
  hasOtherCivilContract: boolean("has_other_civil_contract").notNull().default(false),
  otherContractNote: text("other_contract_note"),
  hasEmploymentContract: boolean("has_employment_contract").notNull().default(false),
  employmentPayAtLeastMinWage: boolean("employment_pay_at_least_min_wage"),
  hasBusinessActivity: boolean("has_business_activity").notNull().default(false),
  isRetiredOrPensioner: boolean("is_retired_or_pensioner").notNull().default(false),
  wantsVoluntarySicknessInsurance: boolean("wants_voluntary_sickness_insurance")
    .notNull()
    .default(false),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  pdfFileId: uuid("pdf_file_id").references(() => files.id),
  createdAt: createdAt(),
});

export const bills = pgTable(
  "bills",
  {
    id: id(),
    contractId: uuid("contract_id").notNull().references(() => contracts.id),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    period: text("period").notNull(), // YYYY-MM
    hours: numeric("hours", { precision: 8, scale: 2 }),
    grossAmount: numeric("gross_amount", { precision: 12, scale: 2 }).notNull(),
    note: text("note"),
    status: billStatusEnum("status").notNull().default("draft"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id),
    rejectedReason: text("rejected_reason"),
    pdfFileId: uuid("pdf_file_id").references(() => files.id),
    pdfSha256: text("pdf_sha256"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("bills_contract_period_uq").on(t.contractId, t.period),
    index("bills_org_period_idx").on(t.orgId, t.period, t.status),
  ],
);

export const acceptances = pgTable(
  "acceptances",
  {
    id: id(),
    orgId: uuid("org_id").notNull().references(() => organizations.id),
    userId: uuid("user_id").notNull().references(() => users.id),
    subjectType: acceptanceSubjectEnum("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    documentSha256: text("document_sha256").notNull(),
    method: text("method").notNull().default("click+reauth"),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("acceptances_subject_idx").on(t.subjectType, t.subjectId)],
);

// Append-only: trigger w migracji 0001 blokuje UPDATE/DELETE/TRUNCATE.
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    orgId: uuid("org_id").references(() => organizations.id),
    actorUserId: uuid("actor_user_id"), // bez FK: wpis ma przeżyć usunięcie użytkownika
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`), // BEZ danych osobowych
    ip: inet("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_org_created_idx").on(t.orgId, t.createdAt)],
);

export const retentionJobs = pgTable("retention_jobs", {
  id: id(),
  orgId: uuid("org_id").notNull().references(() => organizations.id),
  runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
  entityType: text("entity_type").notNull(),
  affectedCount: integer("affected_count").notNull().default(0),
  status: jobStatusEnum("status").notNull(),
});
