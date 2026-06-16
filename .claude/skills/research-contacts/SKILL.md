---
name: research-contacts
description: >-
  Research the decision-makers / best interview targets at monitoring-station
  companies in data/monitoring.db, find and VERIFY their current email, capture
  their LinkedIn profile, and save them to the contacts table. Goal is securing
  blog interviews (monitoringstationguide.com/blog) via cold outreach, so emails
  must be current and deliverable — not stale or guessed. Use when asked to
  "research contacts", "find decision-makers", "enrich companies with people",
  "get LinkedIn profiles", or prep companies for interview outreach.
---

# Research interview contacts for monitoring-station companies

## What this does
For each company in `data/monitoring.db`, find the people most likely to grant a
blog interview, capture each person's **current** email (verified) and **LinkedIn
URL**, and save them to the `contacts` table. Downstream, the user emails them an
interview request via the existing Composer/Resend flow — so a stale or invented
address is worse than none. **Never save an unverified guessed email as if it were
real.**

## Who to target (priority order)
Per company, aim for **2–3 people**:
1. **Lead decision-maker** — owner / founder / President / CEO / Managing Director.
2. **Marketing / PR / brand** — most likely to actually say yes to an interview
   (CMO, Marketing Manager, Communications, Business Development).
3. **Operations backup** — COO / VP Operations / GM, if 1 is hard to reach.

Skip purely junior / support staff. Favor people whose role is **confirmed current**
(LinkedIn shows them presently there).

## Prerequisites (check first)
- `HUNTER_API_KEY` in `.env.local` (see `.env.example`). If missing, tell the user
  to add it and stop — Hunter is how we find + verify emails.
- Optional dedicated verifier: `VERIFIER_PROVIDER` + `VERIFIER_API_KEY` for a
  second-pass bounce check (NeverBounce/ZeroBounce). Defaults to Hunter's verifier.

## Workflow

### 1. Pick the work queue
```bash
node scripts/list-targets.mjs --needs            # companies with 0 contacts (JSON)
node scripts/list-targets.mjs --slug <slug>      # inspect one company + its contacts
```
Process companies in batches. Confirm scope with the user if they didn't specify
(e.g. "all 71" vs "the next 10" vs one slug). Each row gives `slug`, `name`,
`website`, `city`, `region`. Derive the bare **domain** from `website`
(e.g. `https://www.example.com/` → `example.com`).

### 2. Find the people (per company)
Combine two sources — Hunter for emails, web/LinkedIn for who's who and recency:

- **Hunter domain search** lists real mailboxes at the domain with confidence,
  position, department, seniority, and sometimes LinkedIn:
  ```bash
  node scripts/hunter.mjs domain example.com
  node scripts/hunter.mjs domain example.com --seniority executive   # narrow
  ```
- **Exa / web search** (use the `mcp__claude_ai_Exa__web_search_exa` and
  `web_fetch_exa` tools, or WebSearch/WebFetch) to identify the owner/CEO and
  marketing lead by name, and to grab/confirm their **LinkedIn profile URL** and
  that the role is **current**. Search e.g.
  `"<Company name>" owner OR president OR CEO LinkedIn`,
  `"<Company name>" marketing manager`, and read the company About/Team page.

Cross-reference: a name from LinkedIn + an email pattern from Hunter is the
strongest combination.

### 3. Get the best email for each chosen person
- If Hunter's domain search already returned a **personal** email for them → use it.
- Otherwise ask Hunter to construct it from the name:
  ```bash
  node scripts/hunter.mjs find example.com Jane Example
  ```
- **Always verify before saving:**
  ```bash
  node scripts/verify-email.mjs jane@example.com
  ```
  Returns `status ∈ valid | risky | invalid | unknown` (+ score).

### 4. Decide what to store per email (the staleness guard)
- `valid` → save as `emailType: "personal"`, `emailStatus: "valid"`, with the
  confidence score.
- `risky` (catch-all / accept-all domain) → save but mark `emailStatus: "risky"`
  and note it in `notes`; prefer LinkedIn as the primary channel.
- `invalid` → **do not save that address.** Fall back to a role/company address
  (e.g. `info@`, `sales@`) marked `emailType: "company"`, and/or LinkedIn only.
- `unknown` → treat like risky; lean on LinkedIn.
- **LinkedIn is mandatory when an email can't be verified** — it's the reliable
  channel and the user explicitly wants it stored. Always capture `linkedin`.

### 5. Save to the database
Write a JSON array to `data/contacts-<slug>.json` and run the saver. Example item:
```json
[
  {
    "companySlug": "example-monitoring-co",
    "name": "Jane Example",
    "firstName": "Jane",
    "title": "CEO & Chairman",
    "seniority": "executive",
    "department": "executive",
    "email": "jane@example.com",
    "emailType": "personal",
    "emailStatus": "valid",
    "emailConfidence": 95,
    "verifiedAt": "2026-06-09T00:00:00Z",
    "phone": "+1 555 0100",
    "linkedin": "https://www.linkedin.com/in/example-jane",
    "location": "Example City, Country",
    "roleConfirmedAt": "2026-06-09",
    "source": "Hunter domain-search + Exa (LinkedIn) + example.com",
    "notes": "Top decision-maker; founder-era CEO. Verified deliverable."
  }
]
```
```bash
node scripts/save-contacts.mjs data/contacts-example-monitoring-co.json
```
Dedupe is by `linkedin > email > name|slug`, so re-running **updates** a person
rather than duplicating. `companySlug` (or `companyWebsite`) must match a row in
`companies` or the contact is skipped.

### 6. Flag the best target per company
After saving a batch, re-run the primary picker so each company has one starred
interview target (best deliverability + role fit):
```bash
node scripts/set-primary-contacts.mjs
```
The Compose tab reads these: ★ = primary, and email-status badges
(valid/risky/unknown/invalid) drive a "Primary" / "Valid" quick-select plus a
send-time warning for risky/unknown addresses.

### 7. Report
After each batch, summarize: companies done, contacts saved, and a breakdown by
`emailStatus` (valid / risky / invalid-skipped / linkedin-only). Flag companies
where no decision-maker or no usable email could be found so the user can decide.

## Rules
- **Verify every personal email before saving.** Never present a guessed address as
  deliverable. The whole point is not emailing dead/invented mailboxes.
- Always capture **LinkedIn** — it's the fallback channel and an explicit deliverable.
- Record your **sources** and the **date** role/email was confirmed (`roleConfirmedAt`,
  `verifiedAt`) so freshness is auditable later.
- Respect Hunter rate limits; the wrapper retries on 429 but don't hammer it.
- Don't invent people, titles, or LinkedIn URLs. If unsure, say so in `notes` and
  lower confidence — under-claim rather than over-claim.
- This skill **researches and stores only** — it does not send email. Outreach stays
  in the Composer / `/api/send` (Resend) flow.

## Files
| File | Purpose |
|------|---------|
| `scripts/list-targets.mjs` | Work queue: companies + contact counts (JSON) |
| `scripts/hunter.mjs` | Hunter.io: `domain` / `find` / `verify` |
| `scripts/verify-email.mjs` | Pluggable email verifier → valid/risky/invalid/unknown |
| `scripts/save-contacts.mjs` | Upsert contacts from a JSON file into the DB |
| `scripts/set-primary-contacts.mjs` | Flag the best interview target per company (`is_primary`) |
| `src/app/api/contacts/route.ts` | `GET ?q=&primary=1` — serve DB contacts to the Compose tab |
