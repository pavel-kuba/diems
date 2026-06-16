/**
 * Flag the single best interview-outreach target per company (is_primary = 1).
 *
 * "Best" = most likely to (a) actually receive the email and (b) say yes to an
 * interview. We score each contact and mark the top one per company; everyone
 * else is set to 0. Re-runnable; safe to run after each research batch.
 *
 * Scoring:
 *   deliverability (email_status): valid +30, risky +12, unknown +8, invalid/none 0
 *   has a usable email at all:     +10  (a verified inbox beats LinkedIn-only)
 *   role fit for an interview ask:
 *     owner/founder/president/CEO/MD ........ +18
 *     marketing / PR / communications ....... +16  (most likely to say yes)
 *     COO / VP ops / GM / director .......... +10
 *     sales / business development .......... +8
 *     finance / other ....................... +4
 *     generic company inbox (emailType=company, no person) ... -8
 *   email_confidence: + (confidence / 20)   // tiny tie-breaker, 0–5
 *
 * Usage: node scripts/set-primary-contacts.mjs
 */
import Database from "better-sqlite3";
import { DB_PATH } from "./_env.mjs";

const db = new Database(DB_PATH, { fileMustExist: true });

// Additive migration.
const cols = new Set(db.prepare("PRAGMA table_info(contacts)").all().map((c) => c.name));
if (!cols.has("is_primary")) db.exec("ALTER TABLE contacts ADD COLUMN is_primary INTEGER DEFAULT 0");

const statusScore = (s) => ({ valid: 30, risky: 12, unknown: 8 }[s] ?? 0);

function roleScore(c) {
  const t = `${c.title || ""} ${c.department || ""}`.toLowerCase();
  const isInbox = c.email_type === "company" || /general (inbox|inquiries)/.test(t);
  if (isInbox && !/(owner|founder|president|ceo|chief|director|manager|vp|vice)/.test(t)) return -8;
  if (/(owner|founder|president|chief executive|\bceo\b|managing director|\bmd\b|chair)/.test(t)) return 18;
  if (/(market|communicat|\bpr\b|brand)/.test(t)) return 16;
  if (/(\bcoo\b|operations|\bgm\b|general manager|\bvp\b|vice president|director)/.test(t)) return 10;
  if (/(sales|business development|\bbd\b)/.test(t)) return 8;
  return 4;
}

const score = (c) =>
  statusScore(c.email_status) +
  (c.email ? 10 : 0) +
  roleScore(c) +
  (c.email_confidence ? c.email_confidence / 20 : 0);

const slugs = db.prepare("SELECT DISTINCT company_slug FROM contacts WHERE company_slug IS NOT NULL").all();
const clearAll = db.prepare("UPDATE contacts SET is_primary = 0 WHERE company_slug = ?");
const setPrimary = db.prepare("UPDATE contacts SET is_primary = 1 WHERE id = ?");
const getContacts = db.prepare("SELECT * FROM contacts WHERE company_slug = ?");

let flagged = 0;
const tx = db.transaction(() => {
  for (const { company_slug } of slugs) {
    const rows = getContacts.all(company_slug);
    if (!rows.length) continue;
    const best = rows.reduce((a, b) => (score(b) > score(a) ? b : a));
    clearAll.run(company_slug);
    setPrimary.run(best.id);
    flagged++;
    console.log(
      `★ ${best.name} (${best.title || "?"}) [${best.email_status || "no-email"}] → ${company_slug}`
    );
  }
});
tx();

console.log(`\nFlagged ${flagged} primary contact(s), one per company.`);
db.close();
