# Recipe — onboard a new country

End-to-end playbook to add a new country to diems: **import its monitoring
stations** from monitoringstationguide.com, **research the decision-makers**
(via the `research-contacts` skill), **save them with verified emails**, and
**QA that the addresses are actually deliverable** before any outreach.

> This is an orchestration runbook. The judgment-heavy middle (step 3) is the
> existing `research-contacts` skill — this recipe just wraps it with the
> import-before and verify/QA-after steps so a whole country goes from nothing
> to send-ready in one pass.

## Prerequisites
- `HUNTER_API_KEY` in `.env.local` — how emails are found + verified. Without it,
  stop at step 2 (import works; research can't).
- Optional `VERIFIER_PROVIDER` + `VERIFIER_API_KEY` (NeverBounce/ZeroBounce) for a
  stronger second-pass bounce check. Defaults to Hunter's verifier.
- Node 22, deps installed (`npm install`). All scripts are run from the repo root.

Everything writes to the single SQLite file `data/monitoring.db` (companies +
contacts). No other datastore.

---

## Step 0 — pick the country (market) slug
The site organises companies under `/market/<slug>`. The slug becomes the
`companies.market` value and the country axis everywhere in the app.

Discover the currently available slugs:
```bash
curl -s -A "Mozilla/5.0 (diems importer)" https://www.monitoringstationguide.com/ \
  | grep -oE '/market/[a-z-]+' | sort -u
```
As of writing the site offers: `ae ar au be bg ca ch cz de fr gr ie il in jp nl
nz pg pl se sg tr uk us za`.

⚠️ Slug quirks:
- The UK is **`uk`** (not the ISO `gb`) — `src/lib/markets.ts` maps both, but
  import with `uk` to match the site.
- `internal` is reserved for the Angelcam test row — never import to it.

Pick one slug for this run (the rest of the recipe uses **`us`** as the example).

---

## Step 1 — import the companies
```bash
node scripts/import-companies.mjs us      # swap us for your slug
```
What it does: reads `/market/<slug>` (JSON-LD `ItemList`) for the company list,
then each `/company/<company-slug>` page for website / city / region / country /
description, and **upserts** into `companies` with `market = <slug>`. Idempotent —
safe to re-run (matches on `slug`). It prints how many it stored and enriched.

> `import-companies.mjs` only writes the base columns. `revenue_*` / `employees`
> are optional third-party estimates added later by `update-revenue.mjs` — **not**
> required for outreach; skip unless you specifically want them.

---

## Step 2 — confirm the import
```bash
# Company count for the new market (read-only)
node -e 'const d=require("better-sqlite3")("data/monitoring.db",{readonly:true});
  console.log(d.prepare("SELECT market, COUNT(*) n FROM companies WHERE market=? GROUP BY market").get("us"));'

# The new companies — all start with 0 contacts (this is the work queue)
node scripts/list-targets.mjs --needs
```
The country also appears automatically in the app's header **country switcher**
(`/api/markets` derives the list from `companies.market`) — open the app and
confirm the new flag + count show up.

⚠️ `list-targets.mjs --needs` lists **every** 0-contact company across all markets,
not just the new one. Right after a fresh import that's almost entirely the new
country — but note the known CA straggler `api-alarm-ontario` (an intentional
duplicate left without contacts) will also appear. Use `--slug <slug>` to inspect
any single company.

---

## Step 3 — research decision-makers (the `research-contacts` skill)
Run the **`research-contacts`** skill over the new country's companies. It is the
authoritative playbook (`.claude/skills/research-contacts/SKILL.md`); the loop per
company is, in brief:

1. Derive the bare **domain** from the company `website`.
2. **Hunter domain search** for real mailboxes + seniority/department:
   `node scripts/hunter.mjs domain <domain>`
3. **Exa / web / LinkedIn** to name the owner/CEO + a marketing/PR lead and confirm
   the role is **current**, capturing each person's **LinkedIn URL**.
4. Get each person's best email (`hunter find <domain> <First> <Last>` if needed),
   then **verify before saving**:
   `node scripts/verify-email.mjs <email>` → `valid | risky | invalid | unknown`.
5. Apply the **staleness guard**:
   - `valid` → save as `emailType: personal`, `emailStatus: valid` + confidence.
   - `risky` / `unknown` (catch-all) → save but flag; LinkedIn is the real channel.
   - `invalid` → **don't save that address**; fall back to a role inbox
     (`info@`/`sales@`, `emailType: company`) and/or LinkedIn-only.
   - **Always capture `linkedin`** — mandatory whenever an email can't be verified.

Aim for **2–3 targets per company** (lead decision-maker → marketing/PR → ops
backup). **Never save a guessed email as deliverable.** Skip junior/support staff.

Process in batches (e.g. 10 companies) and confirm scope with the user if unspecified.

---

## Step 4 — save + pick primaries
Per company, the skill stages a JSON array at `data/contacts-<slug>.json`, then:
```bash
node scripts/save-contacts.mjs data/contacts-<slug>.json   # upsert; dedupe by linkedin>email>name|slug
```
`companySlug` (or `companyWebsite`) must match a `companies` row or the contact is
skipped. After a batch, re-run the primary picker so each company has one starred
best interview target:
```bash
node scripts/set-primary-contacts.mjs
```

---

## Step 5 — verify deliverability (QA the country before sending)
The skill verifies each personal email at save time. This is the **country-level
QA pass** to confirm the result is healthy and catch anything saved as risky.

Status breakdown for the new market (read-only):
```bash
node -e 'const d=require("better-sqlite3")("data/monitoring.db",{readonly:true});
  const m="us";
  console.log("companies:", d.prepare("SELECT COUNT(*) n FROM companies WHERE market=?").get(m).n);
  console.log("contacts :", d.prepare("SELECT COUNT(*) n FROM contacts ct JOIN companies co ON co.id=ct.company_id WHERE co.market=?").get(m).n);
  console.log("by status:", JSON.stringify(d.prepare("SELECT email_status, COUNT(*) n FROM contacts ct JOIN companies co ON co.id=ct.company_id WHERE co.market=? GROUP BY email_status").all(m)));
  console.log("primaries:", d.prepare("SELECT COUNT(*) n FROM contacts ct JOIN companies co ON co.id=ct.company_id WHERE co.market=? AND ct.is_primary=1").get(m).n);'
```

Re-verify any address you want to double-check (e.g. risky ones before a send):
```bash
node scripts/verify-email.mjs <email>
```

Healthy result looks like: most companies have ≥1 contact, a primary per company,
and the bulk of personal emails are `valid` (with `risky`/`unknown` flagged and
backed by LinkedIn). Flag companies where **no** decision-maker or usable email
could be found so the user can decide whether to chase them manually.

---

## Step 6 — ready to send
The new country is now selectable in the header switcher. Switch to it, open
**Compose**, and the researched contacts appear with their status badges and ★
primaries — the existing send + follow-up flow takes over from here.

Update `PLAN.md` / `CLAUDE.md`'s "Current data state" with the new totals so the
session log stays accurate.

---

## One-glance checklist
```
0. slug      → confirm /market/<slug> exists (uk not gb; never `internal`)
1. import    → node scripts/import-companies.mjs <slug>
2. confirm   → list-targets --needs ; check the header switcher
3. research  → research-contacts skill, 2–3 targets/company, VERIFY every email
4. save      → save-contacts.mjs data/contacts-<slug>.json ; set-primary-contacts.mjs
5. QA        → status-breakdown query ; re-verify risky ; flag gaps
6. send      → pick country in UI → Compose
```
