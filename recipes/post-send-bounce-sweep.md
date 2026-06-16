# Recipe — post-send bounce sweep & cleanup

End-to-end playbook to run a **day or two after each market's send**: ask Resend
which emails actually bounced (there is **no webhook**, so bounces are otherwise
invisible), mark the dead addresses, re-point any ★primaries that died, and catch
the soft failures Resend *doesn't* report (auto-replies, "address not found"
bounce-backs) by mining the inbox.

> This is an orchestration runbook. The mechanical core (step 1) is
> `scripts/check-bounces.mjs`; this recipe wraps it with the re-target /
> re-research / inbox-triage steps so a send goes from "blasted" to "cleaned up
> and reputation-safe" in one pass.

## Prerequisites
- `RESEND_API_KEY` in `.env.local` (the same key used to send) — the sweep polls
  `GET https://api.resend.com/emails/<id>` for each logged send's `last_event`.
- Node 22, deps installed. All scripts run from the repo root.
- A recent send actually happened — check what's there first:
  ```bash
  node -e 'const d=require("better-sqlite3")("data/monitoring.db",{readonly:true});
    for (const r of d.prepare("SELECT date(sent_at) d, COUNT(*) n, SUM(status=\"sent\") sent, SUM(status=\"failed\") failed FROM outreach_sends GROUP BY date(sent_at) ORDER BY d DESC LIMIT 7").all())
      console.log(r.d, "→", r.n, "logged ("+r.sent+" sent, "+r.failed+" failed)");'
  ```

Everything writes to the single SQLite file `data/monitoring.db`. No other datastore.

---

## Step 1 — sweep Resend for bounces
```bash
node scripts/check-bounces.mjs --since 2026-06-15     # the send's date
# node scripts/check-bounces.mjs                      # default: last 3 days
# node scripts/check-bounces.mjs --all                # every logged send ever
# node scripts/check-bounces.mjs --dry-run            # report only, no DB writes
```
What it does, per send (logged `sent`, has a `resend_id`, not already `bounced`):
- looks up `last_event` from Resend;
- `bounced` → `outreach.status='bounced'` (halts follow-ups) +
  `contacts.email_status='invalid'` + a dated note. **Idempotent** — already-bounced
  contacts are excluded by the query, so re-running only checks the rest.
- anything *not* `delivered/opened/clicked/sent/bounced` is printed as a `?` line to
  eyeball (deferred, complaint, etc.) but **not** written.

It throttles ~0.6 s between requests (Resend free tier ≈ 2 req/s), so a big send
takes a while — **~10 min per 1,000 sends**. Run it in the background and read the
log when it finishes:
```bash
node scripts/check-bounces.mjs --since 2026-06-15 > /tmp/bounce-sweep.log 2>&1 &
```

> ⚠️ **Crash-on-network-blip gotcha.** `lastEvent()` retries on HTTP 429 but **not**
> on a network-level throw (`ETIMEDOUT` / "fetch failed"). On a long multi-hundred
> sweep a single transient blip can kill the run mid-way. That's fine — it's
> idempotent: **just re-run the same command** and it resumes (already-marked
> bounces are skipped). Don't pipe through `tee` if you want the real exit code —
> `tee` masks node's non-zero exit; use `> log 2>&1` instead.

At the end it prints the totals and two warnings worth acting on:
- `⚠ A bounced contact was a ★ primary — re-run: set-primary-contacts.mjs` → **step 2**.
- `⚠ Companies with no deliverable contact left (need re-research): …` → **step 3**.
  (This list is **global**, not just this send — it includes pre-existing
  LinkedIn-only / no-email companies, e.g. `g4s-*`, `ivis-*`, `staysafe-*`. Don't
  treat the whole list as freshly broken; cross-check against step 3's query.)

---

## Step 2 — re-pick primaries that bounced
If any ★primary bounced, its email is now `invalid`, so re-run the picker to star
the next-best deliverable contact per company:
```bash
node scripts/set-primary-contacts.mjs
```
Idempotent — re-flags one `is_primary` per company by deliverability + role-fit. A
company whose *only* contact bounced won't get a usable primary → it shows up in
step 3.

---

## Step 3 — find who's genuinely stranded by THIS send
The sweep's stranded warning is global. To see only the companies that **this
send's bounces** left with no deliverable, un-halted contact (the real
re-research / LinkedIn-only work queue):
```bash
node -e 'const d=require("better-sqlite3")("data/monitoring.db",{readonly:true});
  const today=new Date().toISOString().slice(0,10);
  const cos=d.prepare("SELECT DISTINCT c.company_id cid, c.company_slug slug FROM outreach o JOIN contacts c ON c.id=o.contact_id WHERE o.status=\"bounced\" AND date(o.updated_at)=?").all(today);
  const ok=d.prepare("SELECT COUNT(*) n FROM contacts c LEFT JOIN outreach o ON o.contact_id=c.id WHERE c.company_id=? AND c.email IS NOT NULL AND c.email_status IN (\"valid\",\"risky\",\"unknown\") AND COALESCE(o.status,\"active\") IN (\"active\",\"completed\")");
  let rec=0; const stranded=[];
  for (const co of cos){ if (ok.get(co.cid).n>0) rec++; else stranded.push(co.slug); }
  console.log(cos.length+" companies bounced; "+rec+" recovered; "+stranded.length+" stranded:");
  console.log(stranded.join("\n"));'
```
For each stranded company: re-research a fresh decision-maker (the
`research-contacts` skill) **or** fall back to its LinkedIn / role inbox. Don't
re-email the dead address.

---

## Step 4 — mine the inbox for what Resend missed
Resend only reports **hard bounces**. It does **not** catch:
- "address not found" / NDR bounce-backs that arrive as a *reply* to your inbox
  (e.g. the UK send's Russell Miles "address not found");
- out-of-office / auto-replies that name a **successor** or a redirect contact;
- polite declines / "I've left, talk to X" hand-offs.

Open the sending inbox (Superhuman/Gmail) and read the **full bodies** of replies
since the send. For each:
- dead address an auto-reply revealed → mark that contact `bounced`/`invalid` by
  hand (UI **Stop** or a quick DB note) so follow-ups halt;
- a named successor / redirect → add them as a new contact (stage JSON →
  `save-contacts.mjs`) and re-run `set-primary-contacts.mjs`;
- a decline worth keeping → 🔖 flag it on the Contacts tab (Saved bento grid).

This is the **inbox-triage-after-send** playbook — it routinely catches departures
and successors the bounce sweep can't see.

---

## Step 5 — read the bounce rate & record it
A healthy hard-bounce rate is **< 2–3%**. Much higher means the verifier passed
addresses that were actually dead (Hunter `valid` on US/catch-all domains is the
usual culprit) — a **reputation risk** on the sending domain. If a market sweeps
high:
- pace the next blast (smaller batches, the built-in 5 s throttle);
- lean on **LinkedIn** for catch-all domains rather than emailing risky guesses;
- consider a stronger second-pass verifier (`VERIFIER_PROVIDER=neverbounce`) before
  the next send.

Update `PLAN.md` / `CLAUDE.md`'s "Current data state" with the post-sweep status
(enrolled / active / bounced / stopped counts) so the session log stays accurate.

Worked example — the 2026-06-15 send: **939 sent → 86 hard bounces (9.2%)**, 0 other
non-delivered events; 31 bounced ★primaries (re-picked in step 2); 20 companies
genuinely stranded (step 3). The 9.2% was almost all US, mostly verifier-`valid`
mailboxes that were dead — flagged as a reputation concern.

---

## One-glance checklist
```
0. confirm    → which day was the send? (sends-by-day query)
1. sweep      → check-bounces.mjs --since <send-date>   (bg + log; re-run if it crashes — idempotent)
2. re-primary → if any ★primary bounced: set-primary-contacts.mjs
3. stranded   → run the per-send stranded query → re-research or LinkedIn-only
4. inbox      → read FULL reply bodies: dead addrs + successors Resend missed
5. record     → judge bounce rate (<2–3% healthy); update PLAN.md / CLAUDE.md
```
