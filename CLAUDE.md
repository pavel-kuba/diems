@AGENTS.md

# diems — outreach to central monitoring stations

A **local** Next.js app to research decision-makers at central/professional
monitoring-station companies, compose **custom, highlightable** emails, send them
via **Resend**, and run a short **follow-up sequence** with manual reply tracking.
The business goal: secure short Q&A **interviews** for the blog at
https://www.monitoringstationguide.com/blog (a project by Angelcam).

> 🖥️ **Local-only, single-operator tool — run on your machine, not hosted.**
> diems is meant to be **run locally** (`npm run dev` → http://localhost:3000) by
> one person. There is **no deployment, no hosting, no multi-user mode, and no
> authentication** — and it is not designed to be put on a server. All state lives
> on the local disk: the SQLite file **`data/monitoring.db`** plus a little browser
> `localStorage` (Settings + the selected market). **Nothing is synced anywhere** —
> there is no cloud copy. The only outbound traffic is to **Resend** (sending
> email) and **Hunter / the email verifier** (contact research). Always run it on
> the machine that holds `data/monitoring.db`.

> ⚠️ Next.js note: see `AGENTS.md` (imported above). This Next.js (16.2.7) has
> breaking changes — read `node_modules/next/dist/docs/` before writing Next code.

## Stack
- **Next.js 16.2.7** (App Router, Turbopack), **React 19.2.4**, **TypeScript 5**,
  **Tailwind v4**. Runs on **Node 22**.
- **better-sqlite3 12** — synchronous SQLite (companies + contacts + outreach
  state). Native module → kept out of the bundler via `serverExternalPackages` in
  `next.config.ts`.
- **Resend 6** — transactional email send (one email per recipient, threaded).
  No inbound webhook — **replies are tracked by hand** in the UI (see below).
- **Tiptap v3** — rich-text editor; the core feature is selecting text and
  applying a background **highlight** colour.

## Commands
```bash
npm run dev      # http://localhost:3000
npm run build    # production build (also type-checks + lint)
npm run lint     # eslint
```

## Environment (`.env.local`, never committed)
| Var | Purpose |
|-----|---------|
| `RESEND_API_KEY` | Resend send key. **Server-only**, never sent to the browser. `GET /api/send` returns `{configured}` so the UI can show status without exposing it. |
| `SENDING_DOMAIN` | Host used in outbound RFC `Message-ID`s so follow-ups thread under the original (keep it a Resend-verified domain for DKIM alignment). Falls back to the From-address domain if unset. |
| `HUNTER_API_KEY` | Hunter.io — find + verify decision-maker emails at a domain. |
| `VERIFIER_PROVIDER` | Email verifier for `scripts/verify-email.mjs`: `hunter` \| `neverbounce` \| `zerobounce`. Default **`hunter`**. |
| `VERIFIER_API_KEY` | Key for the dedicated verifier (only needed when `VERIFIER_PROVIDER` ≠ `hunter`). |

`.env.example` documents all of these. The Settings tab shows a green ✓ when
`RESEND_API_KEY` is detected. From-address domains must be verified in Resend.

> No `RESEND_WEBHOOK_SECRET` / `svix` — the inbound-reply webhook was built and
> then removed (too much setup for the payoff). Replies are marked manually.

## Data storage — TWO stores (important)
1. **SQLite `data/monitoring.db`** (gitignored, WAL mode) — the source of truth for
   **companies**, **researched contacts**, and **outreach state**. TWO handles on
   the same file (WAL allows 1 writer + many readers):
   - `src/lib/db.ts` — **read-only** cached handle for all company/contact reads.
   - `src/lib/outreach.ts` — **writable** cached handle; owns the `outreach*`,
     `sequence_templates`, `contact_flags` + `todos` tables and `migrate()`s them
     on first open (tracked by `PRAGMA user_version`, currently **6**).
   Companies/contacts are still written only by the `scripts/*.mjs` tools.
2. **Browser localStorage** — only Settings (from/reply-to), the selected
   **country/market** (`diems.market`), and the **message templates** edited on
   the Templates tab (`diems.msg-templates.v2`). The Compose, Contacts, and
   Follow-ups tabs read contacts from SQLite via the API.

### `companies` table
`id, slug, name, website, city, region, country, description, market, detail_url,
position, fetched_at, revenue_text, revenue_usd, employees, revenue_source,
revenue_fetched_at`. Imported from monitoringstationguide.com; revenue/employees
are third-party estimates (Exa) added later. **`market`** (the import slug, e.g.
`ca`, `us`, `internal`) is the **country axis** used by the header switcher and
every tab's filter.

### `contacts` table
`id, company_id, company_slug, name, first_name, title, email, email_type
(personal|role|company), phone, linkedin, location, source, notes,
dedupe_key (UNIQUE), created_at` — plus columns added during the research project:
`seniority, department, email_status (valid|risky|unknown|invalid),
email_confidence (0–100), verified_at, role_confirmed_at, updated_at, is_primary`.

- **`dedupe_key` = `linkedin` > `email` > `name|slug`**, and it's **globally
  unique**. ⚠️ Consequence: one person can only be linked to ONE company. This
  collided for people who appear at two related companies (Chris Currie at Damar +
  Security Response Center; the two Paladins; the two Lanvac listings) — worked
  around by blanking/varying the dedupe field. A proper `people` + `person_company`
  join table is the real fix if the DB grows.
- **`is_primary`** = the single best interview target per company (set by
  `set-primary-contacts.mjs`). The Composer stars these (★).

### `outreach*` + `sequence_templates` tables (follow-up engine — `src/lib/outreach.ts`)
- **`outreach`** — one row per enrolled contact: `contact_id (PK), status
  (active|replied|stopped|bounced|unsubscribed|completed), current_step (-1..3),
  thread_message_id (the step-0 Message-ID = thread anchor), replied_at, updated_at`.
  `replied` and `stopped` are set **manually** from the UI; `completed` is set
  automatically after the last step.
- **`outreach_sends`** — per-email log, `UNIQUE(contact_id, step)`: `id, contact_id,
  step, message_id, resend_id, subject, to_email, status (sent|failed), error, sent_at`.
- **`sequence_templates`** — editable follow-up bodies, `step (PK), body_html,
  updated_at`. A missing row for a step → use the built-in default
  (`FOLLOWUP_BODIES`). Edited via the **Sequence editor** on the Follow-ups tab.
- **`contact_flags`** — hand-picked "interesting for the future" contacts (e.g.
  a polite decline from a senior person): `contact_id (PK), note, opportunity,
  stage, flagged_at`. The optional **`opportunity`** label (added in migration v4)
  groups several saved contacts into ONE opportunity on the Saved tab (e.g. two
  people at the same prospect). The optional **`stage`** (migration v6) is the
  Saved-tab Kanban column (`lead|contacted|replied|scheduled|won|lost`); NULL means
  "derive from the contact's outreach status" until the operator drags the card.
  Flagged via 🔖 on the Contacts tab; reviewed on the **Saved** tab — either as a
  coloured bento grid grouped by opportunity **or as a Kanban board** (List/Board
  toggle), via `/api/flags` GET/POST/DELETE.
- **`outreach_events`** — **vestigial** (created by the v1 migration for the
  removed webhook; `logEvent`/`findContactByEmail` still exist but nothing calls
  them). Left in place; safe to ignore.
- **`todos`** (migration v5) — the human operator's personal checklist: `id,
  text, done (0|1), created_at, done_at`. **Not** market-scoped (a free-form
  list that ignores the country switcher, so a reminder doesn't vanish when you
  change country). Managed on the **To-do** tab (`/api/todos` GET/POST/PATCH/DELETE).

## Source layout (`src/`)
| File | Purpose |
|------|---------|
| `app/page.tsx` | Tabbed shell: **Compose / Follow-ups / Templates / Companies / Contacts / Settings / Saved / To-do**, wrapped in `CountryProvider`; two-row header hosts the `CountrySelector` (row 1) + the segmented tab nav (row 2, own full-width row so 8 tabs never wrap). |
| `app/layout.tsx`, `app/globals.css` | Shell + Tailwind |
| `components/Composer.tsx` | Initial send (step 0). Reads DB contacts (`/api/contacts?market=`) + outreach state (`/api/outreach/status`): status badges, ★ primary, outreach badges, quick-selects, send-time guard. Filtered by the selected country. Excludes halted (`replied`/`stopped`/`bounced`/`unsubscribed`) **and already-contacted** (`current_step >= 0`) contacts from a fresh send. |
| `components/Followups.tsx` | Lists contacts **due** for their next follow-up (`/api/followups/due?market=`); sends the batch via `/api/followups/send`; **Stop** button (`/api/outreach/mark`); embeds the `SequenceEditor`. |
| `components/Saved.tsx` | **Saved** tab — flagged contacts via a **List / Board toggle** (`/api/flags`). List = **coloured bento grid grouped by `opportunity`**: edit note / opportunity / remove, status + outreach badges, LinkedIn. Board = the Kanban (`SavedBoard`). Market-scoped; persists the toggle to localStorage (`diems.saved.view`). |
| `components/SavedBoard.tsx` | **Kanban** view of the Saved deals — one card per company/opportunity across the `PIPELINE_STAGES` columns; native HTML5 drag sets `contact_flags.stage` for the whole deal. Lost/Replied drags also halt/mark the sequence via `/api/outreach/mark`. |
| `components/Todos.tsx` | **To-do** tab — the operator's manual checklist (`/api/todos`): add / check off / click-to-edit / delete, with a collapsed "Done" section + clear-completed. **Not** market-scoped (ignores the country switcher). |
| `components/SequenceEditor.tsx` | Edit/reset the follow-up bodies for steps 1–3 (`/api/sequence`); per-step **Send test** preview to a throwaway address (`/api/sequence/test`, default `DEFAULT_TEST_TO`). |
| `components/Templates.tsx` | **Templates** tab — copy-and-send message templates (profile-claim + interview questions). Look up a contact (`/api/contacts?q=`) to auto-fill first name / company / email + the company's website/location/description; capability toggles (video/active-deterrence/brand-agnostic) for the claim; `[merge tags]` fill live; Copy buttons. Editable bodies persist to localStorage (`diems.msg-templates.v2`). **Nothing is sent** — manual copy/paste. |
| `components/Companies.tsx` | Company list + live search (`/api/companies?q=&market=`) |
| `components/Contacts.tsx` | **Read-only** DB contact directory (`/api/contacts` + outreach badges): grouped by company, status + outreach badges, ★ primary, LinkedIn links, search + primary-only filter, **Stop sequence / Resume** buttons (`/api/outreach/mark`). Created via the research scripts, not edited here. |
| `components/CountrySelector.tsx` | Header dropdown of available markets (`/api/markets`); sets the shared country via `useCountry`. |
| `components/Editor.tsx` | Tiptap editor + highlight toolbar |
| `components/Settings.tsx` | From / Reply-to (localStorage) + env-key status |
| `lib/country.tsx` | `CountryProvider` + `useCountry()` — selected market shared across tabs, persisted to localStorage (`diems.market`). |
| `lib/markets.ts` | `marketName`/`marketFlag` (code → country name + emoji flag) + `MarketFacet` type. |
| `lib/store.ts` | localStorage `Settings` type + SSR-safe `useLocalStorage` hook |
| `lib/contacts.ts` | Shared `DBContact` type + `email_status` helpers (`statusOf`, `isSendable`, badge classes) |
| `lib/outreach-ui.ts` | **Client-safe** outreach badge helper (`outreachBadge`, `OutreachStatusRow`) — no server imports |
| `lib/pipeline.ts` | **Client-safe** Saved-tab Kanban config: `PIPELINE_STAGES`, `StageId`, `defaultStageFor` (seed a stage from outreach status), `groupIntoDeals` (collapse flagged contacts into deal cards) — no server imports |
| `lib/outreach.ts` | **Server-only**: writable DB handle + migrations, send logging, step advance, manual reply/stop marking, due-contact queries, follow-up template CRUD, saved-contact flags (+ `opportunity` grouping) + the `todos` checklist CRUD |
| `lib/sequence.ts` | The follow-up sequence as config: `STEP_OFFSETS_DAYS [0,2,5,10]`, `MAX_STEP=3`, default `FOLLOWUP_BODIES`, `followupSubject` (`Re:`-prefix) |
| `lib/signature.ts` | `SIGNATURE_HTML` — Pavel's signature, single source of truth shared by the initial body + all follow-ups |
| `lib/sender.ts` | Shared low-level Resend `sendOne()` — sets `Message-ID` + `In-Reply-To`/`References` for threading |
| `lib/email.ts` | `applyMergeTags`, `personalizeSubject`, `highlightsToInlineSpans` (`<mark>`→inline `<span>`), `buildEmailHtml` (plain 640px shell), `htmlToText`, `emailAddress`, `domainOf`, `buildMessageId` |
| `lib/db.ts` | Read-only cached SQLite handle (`getDb`), `CompanyRow` type |
| `app/api/send/route.ts` | `POST` initial send → Resend (one per recipient, **5 s** throttle); logs **step 0** + enrolls DB contacts. `GET` → `{configured}` |
| `app/api/followups/due/route.ts` | `GET ?market=` → contacts due for their next follow-up |
| `app/api/followups/send/route.ts` | `POST {from,replyTo,preheader,contactIds?}` → send due follow-ups (recomputes due server-side; threads under step 0) |
| `app/api/sequence/route.ts` | `GET` follow-up templates; `PUT {step,bodyHtml}` save; `DELETE ?step=` reset to default |
| `app/api/sequence/test/route.ts` | `POST {step, bodyHtml?, from?, replyTo?, to?, baseSubject?}` → test-send ONE follow-up step (`[TEST] Re: …` subject) to a throwaway address for inbox preview; does **not** log to `outreach_sends` or advance any step. |
| `app/api/outreach/mark/route.ts` | `POST {contactId,status}` → manually set `active`/`replied`/`stopped` (Stop/Resume) |
| `app/api/outreach/status/route.ts` | `GET` → per-contact outreach state + `dueIds` for UI badges |
| `app/api/flags/route.ts` | `GET ?market=` saved contacts; `POST {contactId, note?, opportunity?, stage?}` flag/update (only the fields present in the body are written) **or** `POST {contactIds:[…], stage}` to move a whole deal to a Kanban stage; `DELETE ?contactId=` unflag |
| `app/api/todos/route.ts` | `GET` list; `POST {text}` add; `PATCH {id, done?\|text?}` toggle/edit; `DELETE ?id=` remove (or `?done=1` clear completed) — the To-do checklist |
| `app/api/markets/route.ts` | `GET` → available markets (company + contact counts) + totals, for the switcher |
| `app/api/companies/route.ts` | `GET ?q=&market=` — search companies |
| `app/api/contacts/route.ts` | `GET ?q=&primary=1&market=` — DB contacts joined to company name (+ the company's `website`/`city`/`region`/`description` for the Templates tab's auto-fill) |

## Country / market switcher
- `companies.market` (the import slug) is the country axis. The header
  `CountrySelector` reads `/api/markets` (each market + its company/contact counts)
  and writes the choice into `useCountry()` (localStorage `diems.market`; `""` =
  all countries).
- Every contact/company-facing endpoint accepts `?market=` and the Compose,
  Follow-ups, Companies, and Contacts tabs pass the current selection through, so
  the whole app is scoped to one country at a time. Changing the country clears any
  recipient selection (guards against accidental cross-market sends).
- The set of markets is whatever import slugs exist in `companies.market` (e.g.
  `us`, `uk`, `ca`, `au`, …); the switcher derives them live from `/api/markets`.
  Start your own with `scripts/import-companies.mjs <market-slug>`.

## Email composition
- Highlights are stored by Tiptap as `<mark style="background-color:…">`; on send
  `email.ts` converts every `<mark>` to an inline-styled `<span>` (email clients
  honour inline `background-color`, not `<mark>`), then wraps the body in a **plain,
  left-aligned 640px shell** styled to read like a normal personal email (no card,
  no centred newsletter layout).
- **Merge tags**: `[First Name]`, `[Company]`, `[Name]` — replaced per recipient;
  empty values fall back to natural defaults (`there` / `your company`) so a literal
  tag never ships.
- **`personalizeSubject`**: for a general inbox with no first name, drops a leading
  `[First Name]<sep>` token from the subject (so `"[First Name] — featuring Acme"`
  becomes `"Featuring Acme"`, not `"there — featuring Acme"`).
- The default subject/body in `Composer.tsx` (`DEFAULT_SUBJECT` /
  `DEFAULT_BODY`) is the interview-request template, signed via `SIGNATURE_HTML`
  (Pavel Kuba, Head of Growth, Angelcam).
- One email per recipient (no shared To/CC), throttled **5 s** apart for
  deliverability. For big blasts, switch to Resend's batch endpoint
  (`resend.batch.send`, ≤100/call).

### Composer recipient logic (the staleness guard)
- `email_status` → badge + behaviour: `valid` = sendable (green); `risky`/`unknown`
  = sendable but **caution** (amber); `invalid` = **not** sendable (red); no email
  / null status = not sendable, shows a **"LinkedIn only"** badge + LinkedIn link.
- Quick-selects: **Primary** (best target per company, verified only), **Valid**
  (all deliverable), **None**; plus a "primary only" filter.
- **Send guard**: selecting any `risky`/`unknown` address pops a confirm warning of
  silent bounces (reputation protection); a second confirm fires for >5 recipients.
- Contacts already `replied`/`stopped`/`bounced`/`unsubscribed` are **excluded**
  from a fresh initial send (and badged), so you don't re-hit someone mid-sequence.
- **Anyone already sent step 0** (`current_step >= 0`, i.e. enrolled and still
  `active`) is also excluded — the initial email never goes out twice; their next
  touch happens in the Follow-ups tab. A hint shows how many rows are hidden
  for this reason.
- **Send loop**: both Compose and Follow-ups send **one recipient per API
  request** with a 5 s client-side gap — gives live per-recipient progress and a
  **Stop** button that can halt a batch mid-way (the server route also spaces
  multi-recipient payloads 5 s apart).

## Follow-up sequence + manual reply tracking
A single campaign (blog interviews); no campaign/enrollment modelling — one
`outreach` row per contact + a per-send log.

- **Sequence** (`lib/sequence.ts`): step 0 = initial (Compose tab). Auto follow-ups
  at **+2d** (bump), **+5d** (new-angle), **+10d** (break-up). After step 3 →
  `completed`. Offsets are days **since the initial send**; the engine waits the gap
  between a contact's current step and the next. Step bodies are editable per step
  (`sequence_templates`, via the Sequence editor); a missing row uses the built-in
  default.
- **Threading**: every email gets an RFC `Message-ID` = `buildMessageId(contactId,
  step, SENDING_DOMAIN)`. Step 0's id is stored as the thread anchor; follow-ups set
  `In-Reply-To` (previous step) + `References` (full chain incl. the anchor) and a
  `Re: <original subject>` subject, so they nest in the recipient's existing thread.
  ⚠️ This assumes **Resend sends our Message-ID verbatim** — de-risk with
  `scripts/probe-messageid.mjs` before trusting it.
- **Sending due follow-ups**: the **Follow-ups tab** → `/api/followups/send`
  recomputes who's due server-side (never trusts the client) and only touches
  `active` contacts, so a reply marked between list and send is naturally excluded.
  A step advances only on send success (a failed step retries next run). Can be
  driven by a cron hitting the endpoint, or run manually from the tab.
- **Reply / stop detection is MANUAL**. There is no inbound webhook. When someone
  replies or isn't interested, click **Stop** (Follow-ups due list) or **Stop
  sequence** (Contacts tab) → `POST /api/outreach/mark` sets `stopped` (or
  `replied`), which halts the sequence; **Resume** sets it back to `active` and
  continues from where it left off. Rationale: most recipients won't reply, so the
  fixed sequence is fine and the webhook/tunnel/MX setup wasn't worth it.

## Scripts (`scripts/`, plain `.mjs`, run with `node`)
| Script | Purpose |
|--------|---------|
| `_env.mjs` | Loads `.env.local` for standalone scripts; exports `DB_PATH`. |
| `import-companies.mjs` | Scrape monitoringstationguide.com → SQLite. `node scripts/import-companies.mjs ca` (swap market slug). |
| `update-revenue.mjs` | Write revenue/employee estimates onto `companies`. |
| `list-targets.mjs` | Work queue: companies + contact counts. `--needs`, `--slug <slug>`, `--limit N`. |
| `hunter.mjs` | Hunter.io CLI: `domain <d>` / `find <d> <First> <Last>` / `verify <email>`. (Free plan caps domain-search at 10.) |
| `verify-email.mjs` | Pluggable verifier → `valid\|risky\|invalid\|unknown` (Hunter/NeverBounce/ZeroBounce). |
| `save-contacts.mjs` | Upsert contacts from a JSON file (`node scripts/save-contacts.mjs data/foo.json`); dedupes; runs additive column migrations. |
| `set-primary-contacts.mjs` | Flag one `is_primary` per company by deliverability + role-fit score. Re-run after each batch. |
| `probe-messageid.mjs` | De-risk threading: send one email with a known `Message-ID`, then check Gmail "Show original" to confirm Resend kept it verbatim. `node scripts/probe-messageid.mjs <to> [from]`. |
| `check-bounces.mjs` | **Post-send bounce sweep** (no webhook → bounces are otherwise invisible). Polls Resend for each logged send's `last_event`; hard bounces → `outreach.status='bounced'` + `email_status='invalid'` + dated note. Flags bounced ★ primaries and companies left with no deliverable contact. `--since YYYY-MM-DD` (default last 3 days), `--all`, `--dry-run`. Run a day or two after each market send; re-run `set-primary-contacts.mjs` if it says so. |
| `strip-company-suffixes.mjs` | Strip trailing legal suffixes from `companies.name` so they read naturally in emails/blog features (`Acme, LLC` → `Acme`). Handles US (LLC/Inc/Corp/Co./Ltd) + intl (`Pty Ltd`, `(Pty) Ltd`, `Pvt Ltd`, `Private Limited`, `PLC`) + parent-company taglines (`… A Pye-Barker … Company`). Dry-run by default; `--apply` writes (backs up the DB first); `--market <slug>\|all`. Idempotent. |

## `research-contacts` skill
`.claude/skills/research-contacts/SKILL.md` is the playbook for finding 2–3
interview targets per company (owner/CEO → marketing/PR → ops backup), getting a
**verified** email + **LinkedIn**, and saving them. Flow: `list-targets` → Hunter
`domain` → Exa/web for who's-who + LinkedIn + recency → `find` → `verify` → write
JSON → `save-contacts` → `set-primary` → Compose. Rule: **never save a guessed
email as deliverable** — `invalid` falls back to a role/company address or
LinkedIn-only; `risky`/accept-all is saved but flagged with LinkedIn as primary.

### "accept-all" / catch-all caveat
Some domains accept mail for any address, so a verifier can't confirm a specific
mailbox → returns `risky`/`unknown`. NeverBounce returns `valid` only when it has
independent evidence the mailbox is real. Treat `risky`/`unknown` as "reach via
LinkedIn"; `valid` as safe to email.

## Recipes (`recipes/`)
End-to-end runbooks that stitch the scripts + skills together.
- **`recipes/new-country.md`** — onboard a whole new country: discover the
  `/market/<slug>` → `import-companies` → `research-contacts` skill (2–3 verified
  targets/company) → `save-contacts` + `set-primary` → QA the deliverability
  breakdown for the market → ready to Compose. (Site slug quirk: UK is `uk`, not
  `gb`; never import to `internal`.)
- **`recipes/post-send-bounce-sweep.md`** — after a market's send, sweep Resend
  for bounces (`check-bounces.mjs`), re-point any dead ★ primaries, and mine the
  inbox for the auto-replies the sweep can't see.
- **`recipes/git-workflow.md`** — how every change lands: a `type/short-desc`
  branch → focused commit(s) → PR → **squash-merge** (`gh`). `main` is never
  committed to directly and must always pass `npm run build`.

## Current data state
The live companies + contacts ship in **`data/monitoring.db`** (gitignored,
**never committed**). A fresh clone starts with an **empty** database — populate
your own by running `scripts/import-companies.mjs <market>` then the
`research-contacts` flow (see the README's *First run — populate the database*).
Per-market counts and any contact-level detail are intentionally kept **out of
version control** (they contain real personal data). The country switcher simply
lists whatever `companies.market` values your DB happens to contain.

## Conventions
- **Git workflow:** every change lands via a `type/short-desc` branch + a
  squash-merged PR (`gh`), **never** committed straight to `main`; commit messages
  are imperative with a `Co-Authored-By` trailer, and `npm run build` must pass
  before merge. Full runbook: **`recipes/git-workflow.md`**.
- `.db`/`.db-wal`/`.db-shm` are gitignored. Storage is **local-only**; no accounts.
- Keep new server-side state in **`data/monitoring.db`** — don't add a second DB.
- Contact-research output is staged as `data/contacts-*.json` then saved via
  `save-contacts.mjs` (reviewable, re-runnable, idempotent via dedupe).
- In browser code, `Math.random()`/`Date.now()` are fine (no SSR-determinism
  constraints there); avoid them in server code that must stay deterministic.
