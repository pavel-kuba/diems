# Recipe — reconcile the inbox into the outreach DB

End-to-end playbook to run **whenever you've been replying to prospects** (and as
a standing pass a day or two after each send): read the real inbox, catch everyone
who replied, **halt their sequences** so the follow-up engine stops bumping them,
and bring the **Saved Kanban** (stage + notes) back in line with the live
conversations. Reply/stop tracking is **manual** (no webhook), so the DB drifts
from reality every time Pavel answers someone in Superhuman — this is the pass
that closes that gap.

> This is an orchestration runbook. The mechanical core is
> `scripts/reconcile-inbox.mjs` (`lookup` / `roster` / `apply`); this recipe wraps
> it with the Superhuman-MCP inbox read + classification so the DB goes from
> "drifted" to "matches the inbox" in one pass. It is the automated version of
> `post-send-bounce-sweep.md`'s Step 4. The matching `reconcile-inbox` **skill**
> drives it interactively.

## Prerequisites
- The **Superhuman Mail MCP** connected (`list_threads`, `get_thread`,
  `query_email_and_calendar`). Interactively authenticated → run this in a real
  session, **not** a headless cron.
- Node 22, deps installed; all scripts run from the repo root.
- Replies land in Pavel's sending inbox (`pavel.kuba@angelcam.com`).

Everything writes to the single SQLite file `data/monitoring.db`. No other
datastore. **`apply` is the only writer** — never hand-edit the DB.

---

## Step 1 — snapshot the worklist
```bash
node scripts/reconcile-inbox.mjs roster --saved --json > data/saved-$(date +%F).json
# add --market us / ca / uk to scope; drop --saved to also dump active contacts
```
Gives the saved deals (the small, thorough set) with each contact's email,
`step0Subject` (`"Featuring <Company>"`), last-sent date, current outreach status,
and current saved `stage`/`note`. This is your reference for steps 4 & 6.

> ⚠️ **Do not iterate the active set.** A market send leaves ~1,500 contacts
> `active`; checking every thread is infeasible and pointless. Replies are found
> from the **inbox** side (step 2) and matched back with `lookup` (step 3).

---

## Step 2 — pull recent replies from Superhuman
Query the inbox for received mail since the last reconcile (or last few days) via
`query_email_and_calendar` / `list_threads`. **Read the FULL body** of each — a
real reply vs. an out-of-office/auto-responder is only obvious from the body (see
the `inbox-triage-after-send` memory). Collect each reply's sender address.

---

## Step 3 — match senders to contacts
```bash
node scripts/reconcile-inbox.mjs lookup alice@corp.com bob@corp.com   # or pipe on stdin
```
Returns each matched contact's `contactId` + current outreach/saved state as JSON.
- **No match?** They replied from a different address, or via a PR agency /
  colleague (e.g. Soteria's Wordswork). Match by **company + subject** instead
  (`step0Subject`), find that company's contacts in the step-1 roster, and
  reconcile the principal target — mark *them* `replied` even if the agency wrote.

---

## Step 4 — classify each reply → a decision
Read the body, map to DB state. A reply (even via agency/CC) **halts the
sequence** — always set an outreach status so no auto-bump fires.

| What the inbox shows | `outreachStatus` | Saved `stage` | also |
|---|---|---|---|
| Wants to proceed / agreed | `replied` | `questions` if interview Qs already sent, else `replied` | set a stage → adds to board |
| Polite decline / not interested | `stopped` | `lost` (if worth keeping) | — |
| "Remove me" / unsubscribe | `unsubscribed` | **— (do NOT add to Saved)** | not an opportunity |
| Out-of-office / vacation | *(no change)* | **— (do NOT add to Saved)** | leave active; resumes when they're back |
| NDR / "no longer here" | `bounced` | **— (do NOT add to Saved)** | `emailStatus:"invalid"`; departure context → `reason` (logged); successor → `save-contacts.mjs` |
| Interview done / published | `replied` | `won` | — |

> ⚠️ **Saved board = opportunities only.** A `stage`/`note`/`noteAppend` on an
> unflagged contact *creates* a Saved flag. Only do that for a genuine reply —
> never for a bounce/unsubscribe/OOO (a bounce isn't a deal). The code now also
> filters bounced/unsubscribed out of the board, but don't lean on it.

---

## Step 5 — stage decisions, dry-run, apply
Write a decisions array to `data/reconcile-<date>.json` (one object per contact;
only `contactId` required). `noteAppend` adds a dated line without losing the
existing note; `note` replaces it.
```bash
node scripts/reconcile-inbox.mjs apply data/reconcile-$(date +%F).json --dry-run
# review the diff (bad status/stage, missing contacts, and no-op rows are skipped & listed)
node scripts/reconcile-inbox.mjs apply data/reconcile-$(date +%F).json
```
Setting a `stage`/`note` on an unflagged contact **adds it to the Saved board** —
exactly right for a freshly-replied prospect. Re-running is safe (idempotent
upserts; `replied`/`stopped` just re-assert).

If a reply named a **successor** (someone left), that's a `save-contacts.mjs` job
(stage JSON → save → `set-primary-contacts.mjs`), same as the bounce sweep — don't
rewrite the address that delivered.

---

## Step 6 — reconcile the existing saved deals
For each deal in the step-1 snapshot, open its thread (`get_thread`) and confirm
the `stage`/`note` still match reality: questions answered → keep `questions` or
move to `won`; gone quiet/declined → `lost`; awaiting Pavel → note it. Fold
corrections into the same decisions file.

---

## Step 7 — report what needs Pavel
The skill/loop applies only the unambiguous changes. **Surface the judgment
calls**: interested replies awaiting Pavel's answer, won/lost decisions, and any
successor research queued. Answering the live replies is Pavel's job — list them
so nothing interested goes cold.

---

## One-glance checklist
```
1. snapshot → reconcile-inbox.mjs roster --saved --json > data/saved-<date>.json
2. inbox    → Superhuman: received mail since last run; read FULL bodies
3. match    → reconcile-inbox.mjs lookup <senders…>   (no match → match by company+subject)
4. classify → reply→replied/stopped/bounced + saved stage (table above)
5. apply    → reconcile-inbox.mjs apply data/reconcile-<date>.json --dry-run → then for real
6. saved    → get_thread each saved deal; correct stale stage/note
7. report   → list interested replies awaiting Pavel (+ won/lost, successors)
```
