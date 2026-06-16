# diems

A **local, single-operator** web app for cold outreach to central / professional
monitoring-station companies: research the decision-makers, compose **custom,
highlightable** emails, send them via **Resend**, and run a short **follow-up
sequence** with manual reply tracking. It was built to secure short Q&A
**interviews** for a blog, but the workflow fits any small, considered B2B
outreach campaign.

> 🖥️ **Run it on your own machine — it is not meant to be hosted.**
> All state lives on local disk: a SQLite file (`data/monitoring.db`) plus a
> little browser `localStorage`. There is **no deployment, no multi-user mode,
> and no authentication**. The only outbound traffic is to Resend (sending) and
> Hunter / an email verifier (contact research). Nothing is synced anywhere.

## What it does

- **Companies & contacts** directory backed by SQLite, scoped by country/market.
- **Composer** with a Tiptap rich-text editor whose signature feature is
  selecting text and applying a background **highlight**. Per-recipient merge
  tags, a deliverability-aware recipient picker, and a staleness guard so you
  never email someone twice or hit a known-bad address.
- **Follow-ups**: a fixed 4-step sequence (initial + 3 nudges) that threads under
  the original email. Replies/opt-outs are marked **by hand** in the UI (no
  inbound webhook).
- **Saved** opportunities and a personal **To-do** list.
- A set of **`scripts/`** for importing companies, researching + verifying
  contacts (Hunter / NeverBounce / ZeroBounce), sweeping for bounces, and more.

## Requirements

- **Node 22+** and npm
- A **[Resend](https://resend.com)** account with a **verified sending domain**
  (needed for DKIM-aligned threading) — required to send email
- *(Optional, for contact research)* a **[Hunter.io](https://hunter.io)** API key,
  and optionally a NeverBounce/ZeroBounce key for email verification

## Setup

```bash
git clone <your-repo-url> diems
cd diems
npm install

# Configure your own keys
cp .env.example .env.local
#   …then edit .env.local and fill in the values (see the table below)
```

### Environment variables (`.env.local`)

`.env.local` is **gitignored** — your keys never leave your machine. Copy
`.env.example` and fill these in:

| Variable | Required | Purpose |
|----------|----------|---------|
| `RESEND_API_KEY` | to send | Resend send key. Server-only, never exposed to the browser. Create at <https://resend.com/api-keys> (starts with `re_`). |
| `SENDING_DOMAIN` | recommended | Host used in outbound `Message-ID`s so follow-ups thread under the original. Use a **Resend-verified domain** for DKIM alignment. Falls back to the From-address domain if unset. |
| `HUNTER_API_KEY` | for research | Hunter.io key — find + verify emails at a domain. <https://hunter.io/api-keys> |
| `VERIFIER_PROVIDER` | optional | Email verifier for `scripts/verify-email.mjs`: `hunter` (default) \| `neverbounce` \| `zerobounce`. |
| `VERIFIER_API_KEY` | optional | Key for the dedicated verifier (only when `VERIFIER_PROVIDER` ≠ `hunter`). |

The **Settings** tab shows a green ✓ when `RESEND_API_KEY` is detected. From-address
domains must be verified in Resend before they'll send.

## Run

```bash
npm run dev      # http://localhost:3000
npm run build    # production build (also type-checks + lints)
npm run lint
```

## First run — populate the database

The app reads from `data/monitoring.db`, which **does not exist on a fresh
clone** (it's gitignored). The import script creates it:

```bash
# 1. Import companies for a market (creates data/monitoring.db on first run).
#    The bundled importer scrapes monitoringstationguide.com — adapt it, or
#    populate the `companies` table from your own source.
node scripts/import-companies.mjs <market-slug>

# 2. Research + verify decision-makers, stage them as JSON, then save.
#    See data/contacts.example.json for the expected shape.
node scripts/save-contacts.mjs data/your-contacts.json

# 3. Flag one best interview target per company.
node scripts/set-primary-contacts.mjs
```

Then open <http://localhost:3000>, pick the market in the header, and compose.

Useful scripts (all `node scripts/<name>.mjs`, most support `--help`-ish flags):

| Script | Purpose |
|--------|---------|
| `import-companies.mjs` | Create/populate the `companies` table for a market. |
| `save-contacts.mjs` | Upsert staged contact JSON (idempotent, de-duped). |
| `set-primary-contacts.mjs` | Pick the best interview target per company. |
| `hunter.mjs` / `verify-email.mjs` | Find / verify emails at a domain. |
| `strip-company-suffixes.mjs` | Tidy legal suffixes off company names (`Acme, LLC` → `Acme`). |
| `check-bounces.mjs` | Post-send bounce sweep via Resend (no webhook). |

## Customize it for you

This started as one person's campaign, so a few things are hardcoded and meant
to be edited:

- **`src/lib/signature.ts`** — the email signature (name, title, phone, links).
- **`src/components/Composer.tsx`** — `DEFAULT_SUBJECT` / `DEFAULT_BODY`, the
  outreach template.
- **`src/lib/sequence.ts`** — follow-up timing (`STEP_OFFSETS_DAYS`) and the
  default follow-up bodies (also editable in-app via the Sequence editor).
- **`src/components/SequenceEditor.tsx`** — `DEFAULT_TEST_TO`, the address the
  per-step "Send test" preview goes to (point it at your own inbox).

## Data & privacy ⚠️

This tool stores **real personal data** about the people you research — names,
emails, phone numbers, LinkedIn URLs. That data lives **only** in
`data/monitoring.db` and your staged `data/*.json` files, all of which are
**gitignored** and never committed. Keep it that way:

- Don't commit the database or any real contact files. Only
  `data/contacts.example.json` (fake data) is tracked.
- You are responsible for using this in line with applicable law (e.g. **GDPR**
  for UK/EU contacts, **CAN-SPAM** for US email): a lawful basis for processing,
  honoring opt-outs, and accurate sender identification.
- `data/monitoring.db` is not synced anywhere — back it up yourself if it matters.

## Tech stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript · Tailwind v4 ·
better-sqlite3 · Resend · Tiptap. See **`CLAUDE.md`** for a deep architecture
tour and **`AGENTS.md`** for a note on this Next.js version's breaking changes.

## License

[MIT](./LICENSE) © 2026 Pavel Kuba
