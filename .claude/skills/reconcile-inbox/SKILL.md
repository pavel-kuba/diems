---
name: reconcile-inbox
description: >-
  Reconcile the diems outreach DB (data/monitoring.db) against the real inbox.
  Reply/stop tracking is MANUAL (no webhook), so the app drifts from reality as
  Pavel replies in Superhuman. This skill reads recent replies via the Superhuman
  Mail MCP, matches each sender back to a contact, and updates outreach status +
  Saved-board stage/notes so the sequence never re-emails someone who already
  replied and the Saved Kanban reflects the truth. Use when asked to "reconcile
  the inbox", "sync replies", "update the saved deals", "check who replied", or
  after a market send. It reads the inbox and writes the DB only — it NEVER sends
  email.
---

# Reconcile the inbox into the outreach DB

## What this does
diems has no inbound webhook — `outreach.status` (`replied`/`stopped`/`bounced`)
and the Saved-board `stage` are set **by hand**. So every time Pavel answers a
prospect in Superhuman, the DB falls out of sync: the follow-up engine may keep
bumping someone who already replied, and the Saved Kanban shows stale stages.

This skill closes that loop. It is **inbox-driven**: it reads the small set of
actual replies, matches each to a contact via `scripts/reconcile-inbox.mjs
lookup`, decides the new state, and writes it back with `apply`. It automates the
manual "Step 4 — mine the inbox" pass from `recipes/post-send-bounce-sweep.md`.

It does two passes:
1. **Reply detection** (inbox-driven) — find new replies, halt those sequences.
2. **Saved-deal reconciliation** (thread-by-thread over the ~dozen saved deals) —
   make each deal's stage + note match the live conversation.

## Prerequisites (check first)
- The **Superhuman Mail MCP** must be connected (tools `list_threads`,
  `get_thread`, `query_email_and_calendar`). It's interactively authenticated, so
  run this in an **interactive session**, not a headless cron.
- The sending inbox is Pavel's (`pavel.kuba@angelcam.com`). Replies land there.
- The DB is local: `data/monitoring.db`. All writes go through the helper script.

## Workflow

### 1. Snapshot the worklist
```bash
node scripts/reconcile-inbox.mjs roster --saved --json > data/saved-$(date +%F).json
```
This lists the saved deals (small, thorough pass) with each contact's email,
`step0Subject`, last-sent date, current outreach status, and current saved
`stage`/`note`. Keep it open as your reference — do NOT iterate the ~1,500 active
contacts; replies are found from the inbox side, not by scanning every thread.

### 2. Pull recent replies from Superhuman
Query the inbox for inbound mail since the last reconcile (or the last few days):
use `query_email_and_calendar` / `list_threads` filtered to received messages.
**Read the FULL body** of each — distinguishing a real reply from an
out-of-office/auto-responder requires it (see `inbox-triage-after-send` memory).

### 3. Match senders to contacts
Collect the reply senders' email addresses and look them all up at once:
```bash
node scripts/reconcile-inbox.mjs lookup someone@corp.com another@corp.com
```
Returns the matching contact's `contactId` + current outreach/saved state as JSON.
- **No match?** The person may have replied from a different address, or via a PR
  agency / colleague. Match by **company + subject** instead (the `step0Subject`
  is `"Featuring <Company>"` / `"<First> — featuring <Company>"`); find that
  company's contacts in the roster and reconcile the principal target.

### 4. Classify each reply → a decision
Map what you read to DB state (see the table). A reply (even via an agency or a
CC) **halts the sequence** — always set an outreach status so no auto-bump fires.

| What the inbox shows | `outreachStatus` | Saved `stage` | also |
|---|---|---|---|
| Genuine reply, wants to proceed / agreed | `replied` | `questions` if interview Qs already sent, else `replied` | add to board (set a stage) so Pavel sees it |
| Polite decline / not interested | `stopped` | `lost` (only if worth keeping) | — |
| "Remove me" / unsubscribe | `unsubscribed` | **— (do NOT add to Saved)** | not an opportunity |
| Out-of-office / vacation auto-reply | *(no change)* | **— (do NOT add to Saved)** | leave active; sequence resumes when they're back |
| NDR / "no longer here" bounce-back | `bounced` | **— (do NOT add to Saved)** | `emailStatus: "invalid"`; departure context → `reason` (logged), not a note; named successor → `save-contacts.mjs` |
| Interview done / published | `replied` | `won` | — |

> ⚠️ **The Saved board is opportunities only.** Setting `stage`, `note`, or
> `noteAppend` on a contact that has no flag yet **creates** one and drops them
> onto the Saved Kanban. Only do that for a genuine reply. For a `bounced`,
> `unsubscribed`, or out-of-office contact, NEVER set `stage`/`note`/`noteAppend`
> — a bounce is not a deal. Record it via `outreachStatus` + `emailStatus` and put
> any human context in the `reason` field (printed in the `apply` log, not
> persisted). `listContactFlags` now also filters bounced/unsubscribed out of the
> board as a backstop, but don't rely on it — don't create the flag.

### 5. Stage decisions, dry-run, then apply
Write a decisions array to `data/reconcile-<date>.json` (one object per contact;
only `contactId` is required). Use `noteAppend` to add a dated line without losing
the existing note; use `note` to replace it. Then:
```bash
node scripts/reconcile-inbox.mjs apply data/reconcile-<date>.json --dry-run
# review the diff, then:
node scripts/reconcile-inbox.mjs apply data/reconcile-<date>.json
```
Setting a `stage`/`note` on a contact with no flag yet **adds it to the Saved
board** — exactly what you want for a freshly-replied prospect.

### 6. Reconcile the existing saved deals
For each deal in the step-1 snapshot, open its thread (`get_thread`) and check the
`stage`/`note` still match reality (questions answered? deal won/lost? awaiting
Pavel?). Fold any corrections into the same decisions file (or a second one).

### 7. Report
Summarise: new replies caught (sequences halted), saved stages corrected, any
bounces/successors found, and **what needs Pavel** (interested replies awaiting
his answer). List those explicitly — answering them is his job, not this skill's.

## Rules
- **Never send email.** This skill reads the inbox and writes the DB only.
  Drafting/sending replies is out of scope (a separate future step).
- **Always `apply --dry-run` first** and review the diff before the real `apply`.
- **Inbox-driven only.** Never iterate all active contacts — match from the
  replies you actually found via `lookup`.
- **Read full bodies.** Don't mark an out-of-office as a reply; don't miss a
  decline buried under pleasantries.
- **A reply halts the sequence.** Set `replied`/`stopped`/`unsubscribed` so the
  follow-up engine stops touching them.
- **Verify before marking bounced.** The roster shows the last real send; only
  mark `bounced`/`invalid` on a genuine NDR, not a soft auto-reply.
- **Saved board = opportunities only.** Never set `stage`/`note`/`noteAppend` on a
  `bounced`/`unsubscribed`/out-of-office contact — it would create a Saved flag for
  a non-deal. Bounces live on `outreachStatus`+`emailStatus`; context goes in
  `reason` (logged, not persisted).
- **Don't overwrite a working email.** A reply from a different address means add
  a contact (via `save-contacts.mjs`), not rewrite the one that delivered.
- **Surface, don't decide, the human calls.** Won/lost and "is this a yes?" are
  Pavel's — flag them, apply only what's unambiguous.

## Files
| File | Purpose |
|------|---------|
| `scripts/reconcile-inbox.mjs` | `lookup` (email → contact + state), `roster [--saved\|--active]` (worklist JSON), `apply <json> [--dry-run]` (write outreach status + Saved stage/note) |
| `scripts/save-contacts.mjs` | Add a successor/redirect contact a reply revealed |
| `scripts/set-primary-contacts.mjs` | Re-pick ★ primary if a reply killed the old one |
| `recipes/reconcile-inbox.md` | The end-to-end runbook this skill follows |
| `recipes/post-send-bounce-sweep.md` | Sibling pass — Resend hard-bounces (run alongside) |
