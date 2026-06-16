/**
 * Post-send bounce sweep — asks Resend for the delivery status of recent sends
 * and marks hard-bounced contacts in the DB. There is no webhook, so this is
 * how bounces get noticed; run it a day or two after each market's send.
 *
 *   node scripts/check-bounces.mjs                 # sends from the last 3 days
 *   node scripts/check-bounces.mjs --since 2026-06-10
 *   node scripts/check-bounces.mjs --all           # every logged send
 *   node scripts/check-bounces.mjs --dry-run       # report only, no DB writes
 *
 * For each bounced send: outreach.status → 'bounced' (halts follow-ups),
 * contacts.email_status → 'invalid', and a dated note is appended. Idempotent —
 * contacts already marked bounced are skipped. Re-run set-primary-contacts.mjs
 * afterwards if any bounced contact was a ★ primary (the script tells you).
 */
import Database from "better-sqlite3";
import { DB_PATH } from "./_env.mjs";

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const ALL = args.includes("--all");
const sinceIdx = args.indexOf("--since");
const since = ALL
  ? "1970-01-01"
  : sinceIdx !== -1 && args[sinceIdx + 1]
    ? args[sinceIdx + 1]
    : new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);

const KEY = (process.env.RESEND_API_KEY || "").trim();
if (!KEY.startsWith("re_")) {
  console.error("Missing/invalid RESEND_API_KEY in .env.local");
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

// Sends to check: logged as sent, have a Resend id, and the contact's sequence
// hasn't already been marked bounced.
const sends = db
  .prepare(
    `SELECT s.resend_id, s.contact_id, s.step, s.to_email, s.sent_at,
            c.name, c.company_slug, c.is_primary,
            o.status AS outreach_status
     FROM outreach_sends s
     JOIN contacts c ON c.id = s.contact_id
     LEFT JOIN outreach o ON o.contact_id = s.contact_id
     WHERE s.status = 'sent'
       AND s.resend_id IS NOT NULL
       AND s.sent_at >= @since
       AND COALESCE(o.status, '') <> 'bounced'
     ORDER BY s.sent_at`
  )
  .all({ since });

console.log(
  `Checking ${sends.length} send(s) since ${since}${DRY_RUN ? " (dry run)" : ""}…`
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function lastEvent(resendId) {
  // Resend free tier allows ~2 req/s; 429s get one retry after a pause.
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`https://api.resend.com/emails/${resendId}`, {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    if (res.status === 429) {
      await sleep(2_000);
      continue;
    }
    if (!res.ok) return `http_${res.status}`;
    const data = await res.json();
    return data.last_event || "unknown";
  }
  return "rate_limited";
}

const markBounced = db.prepare(
  `INSERT INTO outreach (contact_id, status, current_step, updated_at)
   VALUES (@id, 'bounced', -1, datetime('now'))
   ON CONFLICT(contact_id) DO UPDATE SET
     status = 'bounced', updated_at = datetime('now')`
);
const invalidateEmail = db.prepare(
  `UPDATE contacts SET
     email_status = 'invalid',
     notes = COALESCE(notes, '') || @note,
     updated_at = datetime('now')
   WHERE id = @id`
);

const bounced = [];
const odd = []; // anything not delivered/opened/clicked/bounced — worth eyeballing

for (let i = 0; i < sends.length; i++) {
  const s = sends[i];
  const ev = await lastEvent(s.resend_id);
  if (ev === "bounced") {
    bounced.push(s);
    if (!DRY_RUN) {
      const note = ` [${new Date().toISOString().slice(0, 10)}: step-${s.step} send BOUNCED (Resend) — address dead despite verifier status.]`;
      markBounced.run({ id: s.contact_id });
      invalidateEmail.run({ id: s.contact_id, note });
    }
    console.log(
      `✗ BOUNCED  ${s.to_email}  (${s.name} — ${s.company_slug}${s.is_primary ? " ★primary" : ""})`
    );
  } else if (!["delivered", "opened", "clicked", "sent"].includes(ev)) {
    odd.push({ ...s, ev });
    console.log(`? ${ev}  ${s.to_email}  (${s.company_slug})`);
  }
  if (i < sends.length - 1) await sleep(600);
}

console.log(
  `\nDone. ${bounced.length} bounce(s)${DRY_RUN ? " (no DB changes — dry run)" : " marked"}, ${odd.length} other non-delivered event(s).`
);

if (bounced.some((s) => s.is_primary === 1)) {
  console.log(
    "⚠ A bounced contact was a ★ primary — re-run: node scripts/set-primary-contacts.mjs"
  );
}

// Companies left with no deliverable, un-halted contact at all → need research.
const stranded = db
  .prepare(
    `SELECT co.slug FROM companies co
     WHERE co.market <> 'internal'
       AND EXISTS (SELECT 1 FROM contacts c WHERE c.company_id = co.id)
       AND NOT EXISTS (
         SELECT 1 FROM contacts c
         LEFT JOIN outreach o ON o.contact_id = c.id
         WHERE c.company_id = co.id
           AND c.email IS NOT NULL
           AND c.email_status IN ('valid', 'risky', 'unknown')
           AND COALESCE(o.status, 'active') IN ('active', 'completed')
       )`
  )
  .all()
  .map((r) => r.slug);
if (stranded.length) {
  console.log(
    `⚠ Companies with no deliverable contact left (need re-research): ${stranded.join(", ")}`
  );
}

db.close();
