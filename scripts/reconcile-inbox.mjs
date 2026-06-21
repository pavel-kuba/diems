/**
 * reconcile-inbox.mjs — the deterministic half of the inbox-reconcile loop.
 *
 * Reply/stop detection in diems is MANUAL (no inbound webhook). This script is
 * the DB side of automating that chore; the inbox side (reading Superhuman) is
 * done by Claude via the Superhuman MCP, driven by the `reconcile-inbox` skill.
 *
 * Three modes:
 *
 *   node scripts/reconcile-inbox.mjs lookup <email> [<email> …]
 *     The join key for INBOX-DRIVEN reply detection. Given the senders of recent
 *     inbox replies (read by Claude via the Superhuman MCP — a small set), return
 *     each matching contact's id + current outreach/saved state as JSON, so Claude
 *     can decide the delta. Emails can also be piped on stdin (one per line). This
 *     is the primary path: never iterate all active threads — there are thousands.
 *
 *   node scripts/reconcile-inbox.mjs roster [--market <slug>] [--saved | --active] [--out <file>] [--json]
 *     Emit the worklist as JSON + a human summary. --saved (the small, thorough
 *     pass) lists only flagged/saved contacts so each Kanban stage/note can be
 *     reconciled thread-by-thread. --active lists still-`active` contacts. Default
 *     is both. Each row carries the thread anchor + last subject + last-sent date
 *     to find the thread, plus the contact's current DB state. Writes to
 *     data/reconcile-roster-<date>.json (or --out / --json to stdout).
 *
 *   node scripts/reconcile-inbox.mjs apply <decisions.json | -> [--dry-run]
 *     Apply Claude's reconciliation decisions idempotently, replicating the exact
 *     SQL of markReplied / markStatus / setContactFlag in src/lib/outreach.ts.
 *     --dry-run prints the diff without writing.
 *
 * Decisions JSON is an array of objects (only contactId is required):
 *   {
 *     "contactId": 570,
 *     "outreachStatus": "replied",        // active|replied|stopped|bounced|unsubscribed
 *     "repliedAt": "2026-06-19T15:05:00Z",// optional, for replied (default: now)
 *     "stage": "questions",               // saved-deal Kanban stage, or null to clear
 *     "note": "full replacement note",    // replaces contact_flags.note
 *     "noteAppend": "what changed",        // OR append a dated line to the note
 *     "opportunity": "Soteria",           // saved-deal grouping label, or null to clear
 *     "emailStatus": "invalid",           // set contacts.email_status (e.g. on a bounce)
 *     "reason": "why (logged only)"
 *   }
 * Setting stage/note/opportunity on a contact with no flag row CREATES the flag
 * (i.e. adds it to the Saved board) — intended for newly-replied contacts.
 */
import Database from "better-sqlite3";
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DB_PATH } from "./_env.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Mirrors OutreachStatus that a human/inbox can legitimately set (src/lib/outreach.ts);
// "completed" is engine-only and excluded on purpose.
const SETTABLE_STATUS = new Set([
  "active",
  "replied",
  "stopped",
  "bounced",
  "unsubscribed",
]);
// Mirrors StageId in src/lib/pipeline.ts.
const STAGE_IDS = new Set(["replied", "questions", "won", "lost"]);

const now = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0, 10);

function openDb() {
  const db = new Database(DB_PATH, { fileMustExist: true });
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

// ── roster builder (shared by roster + lookup) ───────────────────────────────
function buildRoster(db, { market = "", onlyActive = false, onlySaved = false } = {}) {
  const sub = (col, id) => col.replaceAll("X.id", id);
  const lastSent = `(SELECT MAX(sent_at) FROM outreach_sends WHERE contact_id = X.id AND status = 'sent')`;
  const lastStep = `(SELECT step FROM outreach_sends WHERE contact_id = X.id AND status = 'sent' ORDER BY step DESC LIMIT 1)`;
  const step0 = `(SELECT subject FROM outreach_sends WHERE contact_id = X.id AND step = 0)`;

  const activeRows = onlySaved
    ? []
    : db
        .prepare(
          `SELECT o.contact_id, o.status, o.current_step, o.thread_message_id, o.replied_at,
                  c.name, c.first_name, c.email, c.email_status, c.linkedin,
                  co.name AS company, co.market,
                  f.opportunity, f.stage AS saved_stage, f.note AS saved_note,
                  ${sub(step0, "o.contact_id")}    AS step0_subject,
                  ${sub(lastSent, "o.contact_id")} AS last_sent_at,
                  ${sub(lastStep, "o.contact_id")} AS last_step
           FROM outreach o
           JOIN contacts c ON c.id = o.contact_id
           LEFT JOIN companies co ON co.id = c.company_id
           LEFT JOIN contact_flags f ON f.contact_id = o.contact_id
           WHERE o.status = 'active' AND (@market = '' OR co.market = @market)`
        )
        .all({ market });

  const savedRows = onlyActive
    ? []
    : db
        .prepare(
          `SELECT f.contact_id, f.opportunity, f.stage AS saved_stage, f.note AS saved_note,
                  c.name, c.first_name, c.email, c.email_status, c.linkedin,
                  co.name AS company, co.market,
                  o.status, o.current_step, o.thread_message_id, o.replied_at,
                  ${sub(step0, "f.contact_id")}    AS step0_subject,
                  ${sub(lastSent, "f.contact_id")} AS last_sent_at,
                  ${sub(lastStep, "f.contact_id")} AS last_step
           FROM contact_flags f
           JOIN contacts c ON c.id = f.contact_id
           LEFT JOIN companies co ON co.id = c.company_id
           LEFT JOIN outreach o ON o.contact_id = f.contact_id
           WHERE (@market = '' OR co.market = @market)`
        )
        .all({ market });

  const byId = new Map();
  const ingest = (r, group) => {
    let e = byId.get(r.contact_id);
    if (!e) {
      e = {
        contactId: r.contact_id,
        name: r.name,
        firstName: r.first_name ?? null,
        email: r.email ?? null,
        emailStatus: r.email_status ?? null,
        linkedin: r.linkedin ?? null,
        company: r.company ?? null,
        market: r.market ?? null,
        groups: [],
        step0Subject: r.step0_subject ?? null,
        outreach: {
          status: r.status ?? null,
          currentStep: r.current_step ?? null,
          lastStep: r.last_step ?? null,
          lastSentAt: r.last_sent_at ?? null,
          threadMessageId: r.thread_message_id ?? null,
          repliedAt: r.replied_at ?? null,
        },
        saved:
          r.opportunity != null || r.saved_stage != null || r.saved_note != null
            ? {
                opportunity: r.opportunity ?? null,
                stage: r.saved_stage ?? null,
                note: r.saved_note ?? null,
              }
            : null,
      };
      byId.set(r.contact_id, e);
    }
    if (!e.groups.includes(group)) e.groups.push(group);
  };
  for (const r of activeRows) ingest(r, "active");
  for (const r of savedRows) ingest(r, "saved");

  const list = [...byId.values()].sort(
    (a, b) =>
      (a.company || "").localeCompare(b.company || "") || a.contactId - b.contactId
  );
  return { list, activeCount: activeRows.length, savedCount: savedRows.length };
}

// ── lookup (inbox-driven join key) ───────────────────────────────────────────
function lookup(args) {
  let emails = args.filter((a) => !a.startsWith("--"));
  if (!emails.length) {
    // Allow piping senders on stdin (one per line / comma-separated).
    const stdin = readFileSync(0, "utf8");
    emails = stdin.split(/[\s,]+/).filter(Boolean);
  }
  if (!emails.length) {
    console.error("Usage: node scripts/reconcile-inbox.mjs lookup <email> [<email> …]");
    process.exit(1);
  }
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()));
  const db = openDb();
  const { list } = buildRoster(db);
  const matches = list.filter((e) => e.email && wanted.has(e.email.toLowerCase()));
  process.stdout.write(JSON.stringify(matches, null, 2) + "\n");
  const found = new Set(matches.map((m) => m.email.toLowerCase()));
  const missing = [...wanted].filter((w) => !found.has(w));
  console.error(
    `\nLooked up ${wanted.size} sender(s): ${matches.length} matched.` +
      (missing.length ? ` Not in roster (new sender? check contacts table): ${missing.join(", ")}` : "")
  );
  db.close();
}

// ── roster ──────────────────────────────────────────────────────────────────
function roster(args) {
  const marketIdx = args.indexOf("--market");
  const market = marketIdx !== -1 ? args[marketIdx + 1] || "" : "";
  const onlySaved = args.includes("--saved");
  const onlyActive = args.includes("--active");
  const outIdx = args.indexOf("--out");
  const toStdout = args.includes("--json");
  const out =
    outIdx !== -1
      ? args[outIdx + 1]
      : join(root, "data", `reconcile-roster-${today()}.json`);

  const db = openDb();
  const { list, activeCount, savedCount } = buildRoster(db, {
    market,
    onlyActive,
    onlySaved,
  });

  const json = JSON.stringify(list, null, 2);
  if (toStdout) process.stdout.write(json + "\n");
  else writeFileSync(out, json + "\n");

  // Human summary (to stderr so --json stdout stays clean).
  const mTag = market ? ` [market=${market}]` : "";
  console.error(
    `\nReconcile roster${mTag}: ${list.length} contact(s) — ${activeCount} active, ${savedCount} saved.`
  );
  for (const e of list) {
    const g = e.groups.join("+");
    const sent = e.outreach.lastSentAt ? e.outreach.lastSentAt.slice(0, 10) : "—";
    const stg = e.saved?.stage ? ` saved:${e.saved.stage}` : e.saved ? " saved" : "";
    console.error(
      `  [${g}] #${e.contactId} ${e.name} — ${e.company ?? "?"} — ${e.outreach.status}/step${e.outreach.lastStep ?? "?"} sent ${sent}${stg}`
    );
  }
  if (!toStdout) console.error(`\nWrote ${out}`);
  db.close();
}

// ── apply ─────────────────────────────────────────────────────────────────--
function apply(args) {
  const DRY_RUN = args.includes("--dry-run");
  const file = args.find((a) => a !== "--dry-run");
  if (!file) {
    console.error("Usage: node scripts/reconcile-inbox.mjs apply <decisions.json | -> [--dry-run]");
    process.exit(1);
  }
  const raw = file === "-" ? readFileSync(0, "utf8") : readFileSync(file, "utf8");
  let decisions;
  try {
    decisions = JSON.parse(raw);
  } catch (e) {
    console.error(`! Could not parse JSON: ${e.message}`);
    process.exit(1);
  }
  if (!Array.isArray(decisions)) {
    console.error("! Decisions file must be a JSON array.");
    process.exit(1);
  }

  const db = openDb();

  const contactExists = db.prepare("SELECT id, name FROM contacts WHERE id = ?");
  const getFlagNote = db.prepare("SELECT note FROM contact_flags WHERE contact_id = ?");

  const markReplied = db.prepare(
    `INSERT INTO outreach (contact_id, status, current_step, replied_at, updated_at)
     VALUES (@id, 'replied', -1, @at, @at)
     ON CONFLICT(contact_id) DO UPDATE SET
       status = 'replied', replied_at = @at, updated_at = @at`
  );
  const markStatus = db.prepare(
    `INSERT INTO outreach (contact_id, status, current_step, updated_at)
     VALUES (@id, @status, -1, @at)
     ON CONFLICT(contact_id) DO UPDATE SET
       status = @status, updated_at = @at`
  );
  const setFlag = db.prepare(
    `INSERT INTO contact_flags (contact_id, note, opportunity, stage, flagged_at)
     VALUES (@id, @note, @opportunity, @stage, @at)
     ON CONFLICT(contact_id) DO UPDATE SET
       note        = CASE WHEN @hasNote  THEN @note        ELSE contact_flags.note        END,
       opportunity = CASE WHEN @hasOpp   THEN @opportunity ELSE contact_flags.opportunity END,
       stage       = CASE WHEN @hasStage THEN @stage       ELSE contact_flags.stage       END`
  );
  const setEmailStatus = db.prepare(
    `UPDATE contacts SET email_status = @status, updated_at = @at WHERE id = @id`
  );

  let applied = 0;
  const skipped = [];

  const run = db.transaction(() => {
    for (const d of decisions) {
      const id = d.contactId;
      if (!Number.isInteger(id)) {
        skipped.push(`(missing/!int contactId in ${JSON.stringify(d).slice(0, 60)})`);
        continue;
      }
      const c = contactExists.get(id);
      if (!c) {
        skipped.push(`#${id} (no such contact)`);
        continue;
      }
      const acts = [];

      // Outreach status.
      if (d.outreachStatus != null) {
        if (!SETTABLE_STATUS.has(d.outreachStatus)) {
          skipped.push(`#${id} (bad status "${d.outreachStatus}")`);
          continue;
        }
        if (d.outreachStatus === "replied") {
          const at = d.repliedAt || now();
          if (!DRY_RUN) markReplied.run({ id, at });
          acts.push(`replied@${at.slice(0, 10)}`);
        } else {
          if (!DRY_RUN) markStatus.run({ id, status: d.outreachStatus, at: now() });
          acts.push(d.outreachStatus);
        }
      }

      // Saved-deal flag (stage / note / noteAppend / opportunity).
      const hasStage = "stage" in d;
      const hasOpp = "opportunity" in d;
      const hasNoteReplace = "note" in d;
      const hasNoteAppend = !hasNoteReplace && typeof d.noteAppend === "string";
      if (hasStage && d.stage != null && !STAGE_IDS.has(d.stage)) {
        skipped.push(`#${id} (bad stage "${d.stage}")`);
        continue;
      }
      if (hasStage || hasOpp || hasNoteReplace || hasNoteAppend) {
        let note = d.note ?? null;
        let hasNote = hasNoteReplace;
        if (hasNoteAppend) {
          const prev = getFlagNote.get(id)?.note;
          const line = `[${today()}: ${d.noteAppend}]`;
          note = prev ? `${prev} ${line}` : line;
          hasNote = true;
        }
        if (!DRY_RUN)
          setFlag.run({
            id,
            note,
            opportunity: d.opportunity ?? null,
            stage: d.stage ?? null,
            at: now(),
            hasNote: hasNote ? 1 : 0,
            hasOpp: hasOpp ? 1 : 0,
            hasStage: hasStage ? 1 : 0,
          });
        if (hasStage) acts.push(`stage=${d.stage ?? "∅"}`);
        if (hasOpp) acts.push(`opp=${d.opportunity ?? "∅"}`);
        if (hasNoteReplace) acts.push("note");
        if (hasNoteAppend) acts.push("note+");
      }

      // Email status (e.g. a bounce surfaced by an NDR reply).
      if (d.emailStatus != null) {
        if (!DRY_RUN) setEmailStatus.run({ id, status: d.emailStatus, at: now() });
        acts.push(`email=${d.emailStatus}`);
      }

      if (acts.length) {
        applied++;
        const why = d.reason ? `  — ${d.reason}` : "";
        console.log(`${DRY_RUN ? "·" : "✓"} #${id} ${c.name}: ${acts.join(", ")}${why}`);
      } else {
        skipped.push(`#${id} (no actionable fields)`);
      }
    }
    if (DRY_RUN) throw new Error("__DRY_RUN__"); // roll back any accidental writes
  });

  try {
    run();
  } catch (e) {
    if (e.message !== "__DRY_RUN__") throw e;
  }

  console.log(
    `\n${DRY_RUN ? "Would apply" : "Applied"} ${applied} change-set(s)${DRY_RUN ? " (dry run — no DB changes)" : ""}.`
  );
  if (skipped.length) console.warn(`! Skipped ${skipped.length}: ${skipped.join(", ")}`);
  db.close();
}

// ── main ──────────────────────────────────────────────────────────────────--
const [mode, ...rest] = process.argv.slice(2);
if (mode === "lookup") lookup(rest);
else if (mode === "roster") roster(rest);
else if (mode === "apply") apply(rest);
else {
  console.error(
    "Usage:\n" +
      "  node scripts/reconcile-inbox.mjs lookup <email> [<email> …]\n" +
      "  node scripts/reconcile-inbox.mjs roster [--market <slug>] [--saved | --active] [--out <file>] [--json]\n" +
      "  node scripts/reconcile-inbox.mjs apply <decisions.json | -> [--dry-run]"
  );
  process.exit(1);
}
