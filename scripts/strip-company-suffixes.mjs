/**
 * Strip trailing legal/corporate suffixes from company names so they read
 * naturally in outreach emails + blog features ("Acme", not "Acme, LLC").
 *
 *   node scripts/strip-company-suffixes.mjs            # dry-run, market=us
 *   node scripts/strip-company-suffixes.mjs --apply     # write (backs up DB first)
 *   node scripts/strip-company-suffixes.mjs --market uk --apply
 *   node scripts/strip-company-suffixes.mjs --market all --apply   # every market
 *
 * Idempotent: re-running after a successful pass changes nothing.
 * On --apply it first writes a timestamped backup next to monitoring.db.
 */
import Database from "better-sqlite3";
import { DB_PATH } from "./_env.mjs";

const APPLY = process.argv.includes("--apply");
const mi = process.argv.indexOf("--market");
const MARKET = mi !== -1 ? process.argv[mi + 1] : "us";

// Parent-company tagline, e.g. ", A Pye-Barker Fire & Safety Company",
// " - A Paladin Technologies Company", "| A Fortus Company" — drop the whole
// tail, not just "Company".
const TAGLINE = /\s*[,\-|]\s*A\s+.+\bCompany\.?$/i;

// Generic trailing legal suffix (optionally preceded by a comma/space).
// Multi-word / parenthesised forms ((Pty) Ltd, Pvt Ltd, Private Limited) come
// first so they match as a unit instead of leaving a dangling "(Pty)".
const SUFFIX =
  /[\s,]+(?:\(?Pty\)?\.?\s*Ltd\.?|\(?Pty\)?\.?\s*Limited|Proprietary\s+Limited|Pvt\.?\s*Ltd\.?|Pvt\.?\s*Limited|Private\s+Limited|Incorporated|Inc\.?|Corporation|Corp\.?|Company|Co\.?|Limited|Ltd\.?|P\.?L\.?C\.?|L\.?L\.?C\.?|P\.?L\.?L\.?C\.?|L\.?L\.?P\.?|L\.?P\.?|P\.?C\.?)\s*$/i;

function clean(name) {
  let n = name.trim().replace(TAGLINE, "").trim();
  for (let i = 0; i < 3; i++) {
    const next = n.replace(SUFFIX, "").trim().replace(/,$/, "").trim();
    if (next === n) break;
    n = next;
  }
  return n;
}

const db = new Database(DB_PATH);
const rows =
  MARKET === "all"
    ? db.prepare("SELECT id, name FROM companies").all()
    : db.prepare("SELECT id, name FROM companies WHERE market = ?").all(MARKET);
const changes = rows
  .map((r) => ({ id: r.id, from: r.name, to: clean(r.name) }))
  .filter((c) => c.to !== c.from && c.to.length >= 2);

console.log(`${changes.length} of ${rows.length} '${MARKET}' companies would change\n`);
for (const c of changes) console.log(`  ${c.from}  →  ${c.to}`);

if (!APPLY) {
  console.log("\nDry-run only. Re-run with --apply to write the changes.");
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = `${DB_PATH}.bak-${stamp}`;
await db.backup(backup);
console.log(`\nBacked up DB → ${backup}`);

const upd = db.prepare("UPDATE companies SET name = ? WHERE id = ?");
const run = db.transaction((cs) => {
  for (const c of cs) upd.run(c.to, c.id);
});
run(changes);
console.log(`Updated ${changes.length} company names in market '${MARKET}'.`);
