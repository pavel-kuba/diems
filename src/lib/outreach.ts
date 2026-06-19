/**
 * Outreach follow-up tracking — stored in the SAME SQLite file as companies +
 * contacts (data/monitoring.db), but via a separate WRITABLE handle.
 *
 * `src/lib/db.ts` keeps its read-only handle for all company/contact reads;
 * this module owns the writable connection used only for outreach state, plus
 * the three outreach tables and the queries over them. WAL mode (already on)
 * permits one writer + many readers on the same file.
 *
 * There's effectively a single campaign (blog interviews), so we don't model
 * campaigns/enrollments — just one `outreach` row per contact + a per-send log.
 */
import Database from "better-sqlite3";
import { join } from "node:path";
import { STEP_OFFSETS_DAYS, MAX_STEP, FOLLOWUP_BODIES } from "@/lib/sequence";

// Cached across hot reloads in dev (separate from db.ts's read-only handle).
const globalForOutreach = globalThis as unknown as {
  _outreachDb?: Database.Database;
};

export function getWritableDb(): Database.Database {
  if (!globalForOutreach._outreachDb) {
    const file = join(process.cwd(), "data", "monitoring.db");
    const db = new Database(file); // writable (companies/contacts already exist)
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    migrate(db);
    globalForOutreach._outreachDb = db;
  }
  return globalForOutreach._outreachDb;
}

function migrate(db: Database.Database): void {
  const version = db.pragma("user_version", { simple: true }) as number;
  if (version < 1) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS outreach (
        contact_id        INTEGER PRIMARY KEY REFERENCES contacts(id),
        status            TEXT NOT NULL DEFAULT 'active',
        current_step      INTEGER NOT NULL DEFAULT -1,
        thread_message_id TEXT,
        replied_at        TEXT,
        updated_at        TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outreach_sends (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id  INTEGER NOT NULL REFERENCES contacts(id),
        step        INTEGER NOT NULL,
        message_id  TEXT NOT NULL,
        resend_id   TEXT,
        subject     TEXT NOT NULL,
        to_email    TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'sent',
        error       TEXT,
        sent_at     TEXT NOT NULL,
        UNIQUE(contact_id, step)
      );
      CREATE INDEX IF NOT EXISTS idx_sends_contact ON outreach_sends(contact_id);
      CREATE TABLE IF NOT EXISTS outreach_events (
        svix_id     TEXT PRIMARY KEY,
        type        TEXT NOT NULL,
        contact_id  INTEGER REFERENCES contacts(id),
        from_email  TEXT,
        subject     TEXT,
        raw         TEXT,
        created_at  TEXT NOT NULL
      );
    `);
    db.pragma("user_version = 1");
  }
  if (version < 2) {
    // Editable bodies for follow-up steps 1..MAX_STEP. A missing row means
    // "use the built-in default" (FOLLOWUP_BODIES). Step 0 is composed live in
    // the Compose tab, so it isn't stored here.
    db.exec(`
      CREATE TABLE IF NOT EXISTS sequence_templates (
        step       INTEGER PRIMARY KEY,
        body_html  TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    db.pragma("user_version = 2");
  }
  if (version < 3) {
    // Hand-picked "interesting for the future" contacts (e.g. a polite decline
    // from a senior person). Surfaced in the Saved tab so they don't get lost
    // among hundreds of contacts.
    db.exec(`
      CREATE TABLE IF NOT EXISTS contact_flags (
        contact_id INTEGER PRIMARY KEY REFERENCES contacts(id),
        note       TEXT,
        flagged_at TEXT NOT NULL
      );
    `);
    db.pragma("user_version = 3");
  }
  if (version < 4) {
    // Optional "opportunity" label on a saved contact. Saved contacts that share
    // the same label are worked as ONE opportunity on the Saved tab — even when
    // they sit at different company records (e.g. a warm reply that hands off to
    // a colleague at a sister company). Lets us group without faking a company
    // merge or needing a people/person_company join table.
    db.exec(`ALTER TABLE contact_flags ADD COLUMN opportunity TEXT;`);
    db.pragma("user_version = 4");
  }
  if (version < 5) {
    // A plain personal to-do list for the human operator — manual reminders
    // ("call NYPD to ID the decision-maker", "reply to Barry Dempsey"). Not
    // tied to a contact or a market: it's a free-form checklist that lives in
    // the same DB so it survives across sessions and machines.
    db.exec(`
      CREATE TABLE IF NOT EXISTS todos (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        text       TEXT NOT NULL,
        done       INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        done_at    TEXT
      );
    `);
    db.pragma("user_version = 5");
  }
  if (version < 6) {
    // Manual Kanban stage for the Saved-tab board (Lead…Won/Lost). NULL means
    // "derive from the contact's outreach status" until the operator drags the
    // card; once dragged, an explicit stage id is stored here.
    db.exec(`ALTER TABLE contact_flags ADD COLUMN stage TEXT;`);
    db.pragma("user_version = 6");
  }
}

const now = () => new Date().toISOString();

// ── Status constants ────────────────────────────────────────────────────────
export type OutreachStatus =
  | "active"
  | "replied"
  | "stopped" // manually halted from the UI (replied / not interested / do-not-contact)
  | "bounced"
  | "unsubscribed"
  | "completed";

// Statuses that halt the sequence (no more follow-ups).
const HALTED = new Set<OutreachStatus>([
  "replied",
  "stopped",
  "bounced",
  "unsubscribed",
  "completed",
]);

// ── Writes ───────────────────────────────────────────────────────────────────

/** Log one sent (or failed) email. Upserts on (contact_id, step). */
export function recordSend(args: {
  contactId: number;
  step: number;
  messageId: string;
  resendId?: string;
  subject: string;
  toEmail: string;
  status?: "sent" | "failed";
  error?: string;
}): void {
  getWritableDb()
    .prepare(
      `INSERT INTO outreach_sends
         (contact_id, step, message_id, resend_id, subject, to_email, status, error, sent_at)
       VALUES (@contactId, @step, @messageId, @resendId, @subject, @toEmail, @status, @error, @sentAt)
       ON CONFLICT(contact_id, step) DO UPDATE SET
         message_id = excluded.message_id,
         resend_id  = excluded.resend_id,
         subject    = excluded.subject,
         to_email   = excluded.to_email,
         status     = excluded.status,
         error      = excluded.error,
         sent_at    = excluded.sent_at`
    )
    .run({
      contactId: args.contactId,
      step: args.step,
      messageId: args.messageId,
      resendId: args.resendId ?? null,
      subject: args.subject,
      toEmail: args.toEmail,
      status: args.status ?? "sent",
      error: args.error ?? null,
      sentAt: now(),
    });
}

/**
 * Move a contact's pointer to `step`. Sets the thread Message-ID on step 0,
 * keeps the contact `active`, and flips to `completed` after the final step.
 */
export function advanceStep(
  contactId: number,
  step: number,
  threadMessageId?: string
): void {
  const status: OutreachStatus = step >= MAX_STEP ? "completed" : "active";
  getWritableDb()
    .prepare(
      `INSERT INTO outreach (contact_id, status, current_step, thread_message_id, updated_at)
       VALUES (@contactId, @status, @step, @threadMessageId, @updatedAt)
       ON CONFLICT(contact_id) DO UPDATE SET
         current_step      = @step,
         status            = @status,
         thread_message_id = COALESCE(@threadMessageId, outreach.thread_message_id),
         updated_at        = @updatedAt`
    )
    .run({
      contactId,
      status,
      step,
      threadMessageId: threadMessageId ?? null,
      updatedAt: now(),
    });
}

/** Flip a contact to `replied` (halts the sequence). */
export function markReplied(contactId: number, repliedAt?: string): void {
  const at = repliedAt || now();
  getWritableDb()
    .prepare(
      `INSERT INTO outreach (contact_id, status, current_step, replied_at, updated_at)
       VALUES (@contactId, 'replied', -1, @at, @at)
       ON CONFLICT(contact_id) DO UPDATE SET
         status     = 'replied',
         replied_at = @at,
         updated_at = @at`
    )
    .run({ contactId, at });
}

/** Set a terminal status (e.g. bounced / unsubscribed) that halts the sequence. */
export function markStatus(contactId: number, status: OutreachStatus): void {
  getWritableDb()
    .prepare(
      `INSERT INTO outreach (contact_id, status, current_step, updated_at)
       VALUES (@contactId, @status, -1, @updatedAt)
       ON CONFLICT(contact_id) DO UPDATE SET
         status     = @status,
         updated_at = @updatedAt`
    )
    .run({ contactId, status, updatedAt: now() });
}

/**
 * Record a webhook event. Idempotent: the svix-id is the PK, so a duplicate
 * delivery is ignored. Returns true if this was a new event.
 */
export function logEvent(e: {
  svixId: string;
  type: string;
  contactId?: number | null;
  fromEmail?: string | null;
  subject?: string | null;
  raw?: string | null;
}): boolean {
  const info = getWritableDb()
    .prepare(
      `INSERT OR IGNORE INTO outreach_events
         (svix_id, type, contact_id, from_email, subject, raw, created_at)
       VALUES (@svixId, @type, @contactId, @fromEmail, @subject, @raw, @createdAt)`
    )
    .run({
      svixId: e.svixId,
      type: e.type,
      contactId: e.contactId ?? null,
      fromEmail: e.fromEmail ?? null,
      subject: e.subject ?? null,
      raw: e.raw ?? null,
      createdAt: now(),
    });
  return info.changes > 0;
}

// ── Reads ──────────────────────────────────────────────────────────────────

/** Match an inbound sender address to a researched contact (case-insensitive). */
export function findContactByEmail(
  email: string
): { id: number; name: string | null; email: string } | undefined {
  return getWritableDb()
    .prepare(
      `SELECT id, name, email FROM contacts
       WHERE email IS NOT NULL AND lower(email) = lower(?) LIMIT 1`
    )
    .get(email.trim()) as
    | { id: number; name: string | null; email: string }
    | undefined;
}

export type OutreachRow = {
  contact_id: number;
  status: OutreachStatus;
  current_step: number;
  thread_message_id: string | null;
  replied_at: string | null;
  last_sent_at: string | null;
};

/** Per-contact outreach state for UI badges (all contacts that have any state). */
export function allOutreachStatus(): OutreachRow[] {
  return getWritableDb()
    .prepare(
      `SELECT o.contact_id, o.status, o.current_step, o.thread_message_id, o.replied_at,
              (SELECT MAX(sent_at) FROM outreach_sends s WHERE s.contact_id = o.contact_id) AS last_sent_at
       FROM outreach o`
    )
    .all() as OutreachRow[];
}

export type DueContact = {
  contact_id: number;
  name: string | null;
  first_name: string | null;
  email: string;
  company: string | null;
  current_step: number;
  next_step: number;
  thread_message_id: string | null;
  step0_subject: string | null;
  last_sent_at: string;
  days_waiting: number;
};

/**
 * Contacts due for their next follow-up: still `active`, last step in 0..MAX-1,
 * and enough days elapsed since the last send to reach the next step's offset.
 */
export function getDueContacts(
  asOf: Date = new Date(),
  market = ""
): DueContact[] {
  const rows = getWritableDb()
    .prepare(
      `SELECT o.contact_id, o.current_step, o.thread_message_id,
              c.name, c.first_name, c.email,
              co.name AS company,
              s.sent_at AS last_sent_at,
              (SELECT subject FROM outreach_sends z
                 WHERE z.contact_id = o.contact_id AND z.step = 0) AS step0_subject
       FROM outreach o
       JOIN contacts c ON c.id = o.contact_id
       LEFT JOIN companies co ON co.id = c.company_id
       JOIN outreach_sends s
         ON s.contact_id = o.contact_id AND s.step = o.current_step
       WHERE o.status = 'active'
         AND o.current_step BETWEEN 0 AND ${MAX_STEP - 1}
         AND c.email IS NOT NULL
         AND (@market = '' OR co.market = @market)`
    )
    .all({ market }) as Array<{
    contact_id: number;
    current_step: number;
    thread_message_id: string | null;
    name: string | null;
    first_name: string | null;
    email: string;
    company: string | null;
    last_sent_at: string;
    step0_subject: string | null;
  }>;

  const asOfMs = asOf.getTime();
  const due: DueContact[] = [];
  for (const r of rows) {
    const nextStep = r.current_step + 1;
    const gapDays =
      STEP_OFFSETS_DAYS[nextStep] - STEP_OFFSETS_DAYS[r.current_step];
    const sentMs = new Date(r.last_sent_at).getTime();
    const daysWaiting = (asOfMs - sentMs) / 86_400_000;
    if (daysWaiting >= gapDays) {
      due.push({
        contact_id: r.contact_id,
        name: r.name,
        first_name: r.first_name,
        email: r.email,
        company: r.company,
        current_step: r.current_step,
        next_step: nextStep,
        thread_message_id: r.thread_message_id,
        step0_subject: r.step0_subject,
        last_sent_at: r.last_sent_at,
        days_waiting: Math.floor(daysWaiting),
      });
    }
  }
  return due;
}

/** Whether a status halts the sequence (exported for callers/guards). */
export function isHalted(status: OutreachStatus): boolean {
  return HALTED.has(status);
}

// ── Follow-up email templates (steps 1..MAX_STEP) ────────────────────────────

/** Body HTML for a follow-up step: the user's saved edit, else the default. */
export function getFollowupBody(step: number): string {
  const row = getWritableDb()
    .prepare(`SELECT body_html FROM sequence_templates WHERE step = ?`)
    .get(step) as { body_html: string } | undefined;
  return row?.body_html ?? FOLLOWUP_BODIES[step] ?? "";
}

export type FollowupTemplate = {
  step: number;
  offsetDays: number;
  bodyHtml: string;
  isCustom: boolean; // true when an edited body overrides the default
};

/** All follow-up steps with their current body (edited or default). */
export function listFollowupTemplates(): FollowupTemplate[] {
  const custom = new Map(
    (
      getWritableDb()
        .prepare(`SELECT step, body_html FROM sequence_templates`)
        .all() as { step: number; body_html: string }[]
    ).map((r) => [r.step, r.body_html])
  );
  const out: FollowupTemplate[] = [];
  for (let s = 1; s <= MAX_STEP; s++) {
    out.push({
      step: s,
      offsetDays: STEP_OFFSETS_DAYS[s],
      bodyHtml: custom.get(s) ?? FOLLOWUP_BODIES[s] ?? "",
      isCustom: custom.has(s),
    });
  }
  return out;
}

/** Save an edited follow-up body. */
export function setFollowupTemplate(step: number, bodyHtml: string): void {
  getWritableDb()
    .prepare(
      `INSERT INTO sequence_templates (step, body_html, updated_at)
       VALUES (@step, @bodyHtml, @updatedAt)
       ON CONFLICT(step) DO UPDATE SET
         body_html  = excluded.body_html,
         updated_at = excluded.updated_at`
    )
    .run({ step, bodyHtml, updatedAt: now() });
}

/** Revert a follow-up step to the built-in default. */
export function resetFollowupTemplate(step: number): void {
  getWritableDb()
    .prepare(`DELETE FROM sequence_templates WHERE step = ?`)
    .run(step);
}

// ── Saved contacts (hand-picked, "interesting for the future") ──────────────

export type FlaggedContact = {
  contact_id: number;
  note: string | null;
  opportunity: string | null;
  stage: string | null;
  flagged_at: string;
  name: string;
  title: string | null;
  email: string | null;
  email_status: string | null;
  linkedin: string | null;
  is_primary: number | null;
  company: string | null;
  market: string | null;
};

/**
 * Flag a contact as interesting, or update its note / opportunity grouping.
 * Field-wise upsert: only the keys present in `fields` are written, so editing
 * the note never clears the opportunity label and vice versa. Pass `null` for a
 * field to explicitly clear it (e.g. `{ opportunity: null }` ungroups it).
 */
export function setContactFlag(
  contactId: number,
  fields: {
    note?: string | null;
    opportunity?: string | null;
    stage?: string | null;
  } = {}
): void {
  const hasNote = "note" in fields;
  const hasOpp = "opportunity" in fields;
  const hasStage = "stage" in fields;
  getWritableDb()
    .prepare(
      `INSERT INTO contact_flags (contact_id, note, opportunity, stage, flagged_at)
       VALUES (@contactId, @note, @opportunity, @stage, @flaggedAt)
       ON CONFLICT(contact_id) DO UPDATE SET
         note        = CASE WHEN @hasNote  THEN @note        ELSE contact_flags.note        END,
         opportunity = CASE WHEN @hasOpp   THEN @opportunity ELSE contact_flags.opportunity END,
         stage       = CASE WHEN @hasStage THEN @stage       ELSE contact_flags.stage       END`
    )
    .run({
      contactId,
      note: fields.note ?? null,
      opportunity: fields.opportunity ?? null,
      stage: fields.stage ?? null,
      hasNote: hasNote ? 1 : 0,
      hasOpp: hasOpp ? 1 : 0,
      hasStage: hasStage ? 1 : 0,
      flaggedAt: now(),
    });
}

/**
 * Move a whole deal to a stage: set `stage` on every member contact in one
 * transaction so a multi-person opportunity stays consistent on the board.
 * Only touches already-flagged contacts (the board's source data).
 */
export function setDealStage(contactIds: number[], stage: string | null): void {
  const db = getWritableDb();
  const tx = db.transaction((ids: number[]) => {
    for (const id of ids) setContactFlag(id, { stage });
  });
  tx(contactIds);
}

/** Remove a contact's flag. */
export function clearContactFlag(contactId: number): void {
  getWritableDb()
    .prepare(`DELETE FROM contact_flags WHERE contact_id = ?`)
    .run(contactId);
}

/** All flagged contacts joined to contact + company details, newest first. */
export function listContactFlags(market = ""): FlaggedContact[] {
  return getWritableDb()
    .prepare(
      `SELECT f.contact_id, f.note, f.opportunity, f.stage, f.flagged_at,
              c.name, c.title, c.email, c.email_status, c.linkedin, c.is_primary,
              co.name AS company, co.market AS market
       FROM contact_flags f
       JOIN contacts c ON c.id = f.contact_id
       LEFT JOIN companies co ON co.id = c.company_id
       WHERE (@market = '' OR co.market = @market)
       ORDER BY f.flagged_at DESC`
    )
    .all({ market }) as FlaggedContact[];
}

// ── To-do list (the human operator's personal checklist) ────────────────────

export type Todo = {
  id: number;
  text: string;
  done: number; // 0 | 1
  created_at: string;
  done_at: string | null;
};

/** All to-dos: open ones first (newest open on top), then done (newest done on top). */
export function listTodos(): Todo[] {
  return getWritableDb()
    .prepare(
      `SELECT id, text, done, created_at, done_at
       FROM todos
       ORDER BY done ASC,
                CASE WHEN done = 0 THEN created_at END DESC,
                done_at DESC`
    )
    .all() as Todo[];
}

/** Add a task; returns the new row. */
export function addTodo(text: string): Todo {
  const info = getWritableDb()
    .prepare(`INSERT INTO todos (text, done, created_at) VALUES (?, 0, ?)`)
    .run(text, now());
  return getWritableDb()
    .prepare(`SELECT id, text, done, created_at, done_at FROM todos WHERE id = ?`)
    .get(info.lastInsertRowid) as Todo;
}

/** Check / uncheck a task (stamps done_at when checked, clears it when reopened). */
export function setTodoDone(id: number, done: boolean): void {
  getWritableDb()
    .prepare(`UPDATE todos SET done = @done, done_at = @doneAt WHERE id = @id`)
    .run({ id, done: done ? 1 : 0, doneAt: done ? now() : null });
}

/** Edit a task's text. */
export function updateTodoText(id: number, text: string): void {
  getWritableDb().prepare(`UPDATE todos SET text = ? WHERE id = ?`).run(text, id);
}

/** Delete one task. */
export function deleteTodo(id: number): void {
  getWritableDb().prepare(`DELETE FROM todos WHERE id = ?`).run(id);
}

/** Clear all completed tasks; returns how many were removed. */
export function clearDoneTodos(): number {
  return getWritableDb().prepare(`DELETE FROM todos WHERE done = 1`).run().changes;
}
