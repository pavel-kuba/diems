/**
 * Save researched decision-maker contacts into the SQLite DB, linked to a
 * company. Reads a JSON array of contacts from a file (or stdin) — written by
 * the research-contacts skill.
 *
 * Usage:
 *   node scripts/save-contacts.mjs data/contacts-api-alarm-inc.json
 *   cat contacts.json | node scripts/save-contacts.mjs -
 *
 * Each contact object (camelCase):
 *   companySlug | companyWebsite   (one required — links to a company row)
 *   name (required), firstName, title, seniority, department,
 *   email, emailType (personal|role|company),
 *   emailStatus (valid|risky|invalid|unknown), emailConfidence (0-100),
 *   verifiedAt (ISO), phone, linkedin (strongly preferred),
 *   location, roleConfirmedAt (ISO — when the role was last confirmed current),
 *   source, notes
 *
 * De-duped by `dedupe_key` (linkedin > email > name|companySlug), so re-running
 * UPDATES an existing person instead of creating a duplicate.
 */
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { DB_PATH } from "./_env.mjs";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/save-contacts.mjs <contacts.json | ->");
  process.exit(1);
}
const raw = arg === "-" ? readFileSync(0, "utf8") : readFileSync(arg, "utf8");
let CONTACTS;
try {
  CONTACTS = JSON.parse(raw);
  if (!Array.isArray(CONTACTS)) throw new Error("JSON root must be an array");
} catch (e) {
  console.error("✗ Could not parse contacts JSON: " + e.message);
  process.exit(1);
}

const db = new Database(DB_PATH, { fileMustExist: true });
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS contacts (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    company_id  INTEGER REFERENCES companies(id),
    company_slug TEXT,
    name        TEXT NOT NULL,
    first_name  TEXT,
    title       TEXT,
    email       TEXT,
    email_type  TEXT,
    phone       TEXT,
    linkedin    TEXT,
    location    TEXT,
    source      TEXT,
    notes       TEXT,
    dedupe_key  TEXT UNIQUE NOT NULL,
    created_at  TEXT NOT NULL
  );
`);

// Additive migration: verification / recency columns added after v1.
const existing = new Set(db.prepare("PRAGMA table_info(contacts)").all().map((c) => c.name));
const ADD = {
  seniority: "TEXT",
  department: "TEXT",
  email_status: "TEXT",
  email_confidence: "INTEGER",
  verified_at: "TEXT",
  role_confirmed_at: "TEXT",
  updated_at: "TEXT",
};
for (const [col, type] of Object.entries(ADD)) {
  if (!existing.has(col)) db.exec(`ALTER TABLE contacts ADD COLUMN ${col} ${type}`);
}

const findCompany = db.prepare(
  "SELECT id, slug, name FROM companies WHERE slug = @slug OR (@web != '' AND website LIKE @web) LIMIT 1"
);

const upsert = db.prepare(`
  INSERT INTO contacts
    (company_id, company_slug, name, first_name, title, seniority, department,
     email, email_type, email_status, email_confidence, verified_at,
     phone, linkedin, location, role_confirmed_at, source, notes,
     dedupe_key, created_at, updated_at)
  VALUES
    (@company_id, @company_slug, @name, @first_name, @title, @seniority, @department,
     @email, @email_type, @email_status, @email_confidence, @verified_at,
     @phone, @linkedin, @location, @role_confirmed_at, @source, @notes,
     @dedupe_key, @created_at, @updated_at)
  ON CONFLICT(dedupe_key) DO UPDATE SET
    company_id=excluded.company_id, company_slug=excluded.company_slug,
    name=excluded.name, first_name=excluded.first_name, title=excluded.title,
    seniority=excluded.seniority, department=excluded.department,
    email=excluded.email, email_type=excluded.email_type,
    email_status=excluded.email_status, email_confidence=excluded.email_confidence,
    verified_at=excluded.verified_at, phone=excluded.phone,
    linkedin=excluded.linkedin, location=excluded.location,
    role_confirmed_at=excluded.role_confirmed_at,
    source=excluded.source, notes=excluded.notes, updated_at=excluded.updated_at;
`);

const now = new Date().toISOString();
let saved = 0;
const skipped = [];

for (const c of CONTACTS) {
  const company = findCompany.get({
    slug: c.companySlug || "",
    web: c.companyWebsite ? `%${c.companyWebsite}%` : "",
  });
  if (!company) {
    skipped.push(`${c.name} (${c.companySlug || c.companyWebsite || "?"})`);
    continue;
  }
  const dedupe_key = c.linkedin || c.email || `${c.name}|${company.slug}`;

  upsert.run({
    company_id: company.id,
    company_slug: company.slug,
    name: c.name,
    first_name: c.firstName ?? null,
    title: c.title ?? null,
    seniority: c.seniority ?? null,
    department: c.department ?? null,
    email: c.email ?? null,
    email_type: c.emailType ?? null,
    email_status: c.emailStatus ?? null,
    email_confidence: c.emailConfidence ?? null,
    verified_at: c.verifiedAt ?? null,
    phone: c.phone ?? null,
    linkedin: c.linkedin ?? null,
    location: c.location ?? null,
    role_confirmed_at: c.roleConfirmedAt ?? null,
    source: c.source ?? null,
    notes: c.notes ?? null,
    dedupe_key,
    created_at: now,
    updated_at: now,
  });
  saved++;
  const tag = c.emailStatus ? ` [${c.emailStatus}]` : "";
  console.log(`✓ ${c.name} — ${c.title ?? "?"} → ${company.name}${tag}`);
}

console.log(`\nSaved/updated ${saved} contact(s).`);
if (skipped.length) console.warn(`! No company match (skipped): ${skipped.join(", ")}`);
db.close();
