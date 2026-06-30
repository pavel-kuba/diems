"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Editor from "@/components/Editor";
import { applyMergeTags, buildEmailHtml, personalizeSubject } from "@/lib/email";
import {
  SETTINGS_KEY,
  emptySettings,
  useLocalStorage,
  type Settings,
} from "@/lib/store";
import { firstNameOf, isSendable, statusOf, type DBContact } from "@/lib/contacts";
import { outreachBadge, type OutreachStatusRow } from "@/lib/outreach-ui";
import { useCountry } from "@/lib/country";
import { marketFlag, marketName } from "@/lib/markets";
import { SIGNATURE_HTML } from "@/lib/signature";

type SendResult = { email: string; ok: boolean; id?: string; error?: string };

const INTERVIEW_BLOG_URL =
  "https://www.angelcam.com/blog/from-alarms-to-cloud-cameras-the-power-of-the-jablotron-angelcam-partnership";
const GUIDE_URL = "https://www.monitoringstationguide.com";
const ANGELCAM_URL = "https://www.angelcam.com";

// Green highlight (matches the editor's green preset swatch).
const HL = "#c7f0d2";
const mark = (text: string) =>
  `<mark data-color="${HL}" style="background-color: ${HL}">${text}</mark>`;

const DEFAULT_SUBJECT = "[First Name] — featuring [Company]";

const DEFAULT_BODY =
  "<p>Hi [First Name],</p>" +
  `<p>I run <a href="${GUIDE_URL}">${mark("Monitoring Station Guide")}</a>, a project by ` +
  `<a href="${ANGELCAM_URL}">${mark("Angelcam")}</a> that compares professional monitoring ` +
  "stations around the world. [Company] is already listed, and the site has had " +
  mark("10,000+ unique visitors in the last 90 days") +
  ".</p>" +
  "<p>We're publishing short Q&amp;A interviews with monitoring leaders this " +
  "summer. " +
  mark("It's free and you approve your quotes before publishing") +
  ` — same style as <a href="${INTERVIEW_BLOG_URL}">this one</a>.</p>` +
  "<p>Two easy ways to do it, whichever suits you:</p>" +
  "<ul>" +
  "<li>Async — we email the questions, you reply when you have a minute, or</li>" +
  "<li>A quick call — phone or online, ~20 minutes.</li>" +
  "</ul>" +
  "<p>Open to it?</p>" +
  "<p></p>" +
  SIGNATURE_HTML;

export default function Composer({ goToSettings }: { goToSettings: () => void }) {
  const [settings] = useLocalStorage<Settings>(SETTINGS_KEY, emptySettings);
  const { market } = useCountry();

  const [contacts, setContacts] = useState<DBContact[]>([]);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [outreach, setOutreach] = useState<Map<number, OutreachStatusRow>>(new Map());
  const [dueIds, setDueIds] = useState<Set<number>>(new Set());

  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [preheader, setPreheader] = useState("");
  const [body, setBody] = useState(DEFAULT_BODY);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [extra, setExtra] = useState(""); // ad-hoc emails, comma separated
  const [query, setQuery] = useState("");
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [sendTotal, setSendTotal] = useState(0);
  const [currentSend, setCurrentSend] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const [topError, setTopError] = useState<string | null>(null);
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  useEffect(() => {
    fetch("/api/send")
      .then((r) => r.json())
      .then((d) => setKeyConfigured(!!d.configured))
      .catch(() => setKeyConfigured(false));
  }, []);

  useEffect(() => {
    const qs = market ? `?market=${encodeURIComponent(market)}` : "";
    fetch(`/api/contacts${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setContactsError(d.error);
        setContacts((d.contacts as DBContact[]) || []);
      })
      .catch((e) => setContactsError(e instanceof Error ? e.message : "Failed to load contacts"));
    // Clear any selection from the previous country to avoid sending cross-market.
    setSelected(new Set());
  }, [market]);

  // Outreach state per contact — used to badge rows and keep already-replied /
  // bounced people out of a new initial send.
  useEffect(() => {
    fetch("/api/outreach/status")
      .then((r) => r.json())
      .then((d) => {
        const rows = (d.statuses as OutreachStatusRow[]) || [];
        setOutreach(new Map(rows.map((r) => [r.contact_id, r])));
        setDueIds(new Set((d.dueIds as number[]) || []));
      })
      .catch(() => {
        /* outreach status is non-critical for composing */
      });
  }, []);

  // Contacts whose sequence has halted (replied / bounced / unsubscribed) — not
  // eligible for a fresh initial send.
  const isHalted = (id: number) => {
    const st = outreach.get(id)?.status;
    return (
      st === "replied" ||
      st === "stopped" ||
      st === "bounced" ||
      st === "unsubscribed"
    );
  };

  // Already received the initial email (enrolled in the sequence). Excluded from
  // a new Compose send so nobody gets double-emailed — follow-ups are handled in
  // the Follow-ups tab instead.
  const alreadyContacted = (id: number) => {
    const r = outreach.get(id);
    return !!r && r.current_step >= 0;
  };

  // Internal / test contacts (e.g. Pavel @ Angelcam) are always re-sendable so the
  // send flow can be exercised on demand — the contacted/halted guards don't apply.
  const isInternal = (c: DBContact) => c.market === "internal";

  // Eligible for a fresh initial send: has a usable email, and (unless it's an
  // internal test contact) isn't halted or already contacted.
  const selectableForInitial = (c: DBContact) =>
    isSendable(c) && (isInternal(c) || (!isHalted(c.id) && !alreadyContacted(c.id)));

  const from = settings.fromName
    ? `${settings.fromName} <${settings.fromEmail}>`
    : settings.fromEmail;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (primaryOnly && c.is_primary !== 1) return false;
      if (!q) return true;
      return [c.name, c.email, c.company, c.title].some((v) =>
        (v || "").toLowerCase().includes(q)
      );
    });
  }, [contacts, query, primaryOnly]);

  // The rows actually rendered. "Selected only" collapses the list to just the
  // people who'll receive this send, so the operator can review the final set
  // without the already-contacted / not-selectable noise. Kept separate from
  // `filtered` so the quick-selects and counts still see the full set.
  const visible = useMemo(
    () => (selectedOnly ? filtered.filter((c) => selected.has(c.id)) : filtered),
    [filtered, selectedOnly, selected]
  );

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectWhere = (pred: (c: DBContact) => boolean) =>
    setSelected(
      new Set(
        filtered.filter((c) => selectableForInitial(c) && pred(c)).map((c) => c.id)
      )
    );

  // How many in the current view are hidden from selection because they were
  // already emailed (shown as a hint so the count isn't a mystery).
  const contactedCount = useMemo(
    () =>
      filtered.filter(
        (c) => !isInternal(c) && isSendable(c) && !isHalted(c.id) && alreadyContacted(c.id)
      ).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, outreach]
  );

  const recipients = useMemo(() => {
    const list: {
      email: string;
      name?: string;
      firstName?: string;
      company?: string;
      status?: string | null;
      contactId?: number;
    }[] = [];
    for (const c of contacts) {
      if (selected.has(c.id) && c.email && selectableForInitial(c))
        list.push({
          email: c.email,
          name: c.name || undefined,
          firstName: firstNameOf(c),
          company: c.company || undefined,
          status: c.email_status,
          contactId: c.id,
        });
    }
    for (const raw of extra.split(/[,\s;]+/)) {
      const e = raw.trim();
      if (e && e.includes("@") && !list.some((r) => r.email === e))
        list.push({ email: e, status: "manual" });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contacts, selected, extra, outreach]);

  // Recipients whose deliverability is uncertain (risky / unknown) — warn before send.
  const cautionRecipients = useMemo(
    () => recipients.filter((r) => r.status && statusOf(r.status).caution),
    [recipients]
  );

  // Preview personalised for the first selected recipient (or fallbacks).
  const previewVars = recipients[0] ?? {};
  const previewHtml = useMemo(
    () => buildEmailHtml(applyMergeTags(body, previewVars), { preheader }),
    [body, preheader, previewVars]
  );
  const previewSubject = personalizeSubject(subject, previewVars);

  const canSend =
    keyConfigured !== false &&
    !!from &&
    !!subject.trim() &&
    recipients.length > 0 &&
    !sending;

  const send = async () => {
    setTopError(null);
    setResults(null);

    if (keyConfigured === false) {
      setTopError(
        "RESEND_API_KEY is not set on the server. Add it to .env.local and restart."
      );
      return;
    }
    if (!settings.fromEmail) {
      setTopError("Set a From address in Settings first.");
      return;
    }
    if (recipients.length === 0) {
      setTopError("Select at least one recipient.");
      return;
    }
    // Staleness guard: emailing risky/unknown addresses can bounce silently and
    // hurt sender reputation. Make the user opt in explicitly.
    if (cautionRecipients.length > 0) {
      const sample = cautionRecipients
        .slice(0, 5)
        .map((r) => `• ${r.email} (${statusOf(r.status!).label})`)
        .join("\n");
      const more =
        cautionRecipients.length > 5 ? `\n…and ${cautionRecipients.length - 5} more` : "";
      if (
        !window.confirm(
          `${cautionRecipients.length} recipient(s) have an unverified (risky/unknown) email and may bounce silently:\n\n${sample}${more}\n\nConsider reaching these people on LinkedIn instead. Send anyway?`
        )
      )
        return;
    }
    if (
      recipients.length > 5 &&
      !window.confirm(`Send this email to ${recipients.length} recipients now?`)
    )
      return;

    // Send one recipient per request so the UI can show live progress and the
    // 5s spacing is visible — and so a long batch can be stopped mid-way.
    const list = recipients.slice();
    cancelRef.current = false;
    setSending(true);
    setSendTotal(list.length);
    const collected: SendResult[] = [];
    setResults([]);

    for (let i = 0; i < list.length; i++) {
      if (cancelRef.current) break;
      const r = list[i];
      setCurrentSend(r.email);
      try {
        const res = await fetch("/api/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            replyTo: settings.replyTo || undefined,
            subject,
            bodyHtml: body,
            preheader: preheader || undefined,
            recipients: [
              {
                email: r.email,
                name: r.name,
                firstName: r.firstName,
                company: r.company,
                contactId: r.contactId,
              },
            ],
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          collected.push({ email: r.email, ok: false, error: data.error || "Send failed." });
        } else {
          collected.push(
            (data.results?.[0] as SendResult) ?? { email: r.email, ok: true }
          );
        }
      } catch (e) {
        collected.push({
          email: r.email,
          ok: false,
          error: e instanceof Error ? e.message : "Network error.",
        });
      }
      setResults([...collected]);
      // 5s gap before the next one (skip after the last / if stopped).
      if (i < list.length - 1 && !cancelRef.current) await sleep(5_000);
    }

    setCurrentSend(null);
    setSending(false);
  };

  const stopSending = () => {
    cancelRef.current = true;
  };

  const settingsReady = keyConfigured !== false && !!settings.fromEmail;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      {/* Main column */}
      <div className="space-y-3">
        {!settingsReady && (
          <Banner>
            {keyConfigured === false
              ? "RESEND_API_KEY is not set on the server — add it to .env.local and restart. "
              : "Set your From address in "}
            <button onClick={goToSettings} className="font-semibold underline">
              Settings
            </button>{" "}
            before sending.
          </Banner>
        )}

        <div className="card space-y-2.5 p-3.5">
          <Labeled
            label="Subject"
            hint={"Merge tags: [First Name], [Company], [Name] — replaced per recipient."}
          >
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="A quick question for your monitoring centre"
              className="input"
            />
          </Labeled>
          <Labeled
            label="Preview text (optional)"
            hint="Short line shown after the subject in most inboxes."
          >
            <input
              value={preheader}
              onChange={(e) => setPreheader(e.target.value)}
              placeholder="Helping central monitoring stations cut false alarms…"
              className="input"
            />
          </Labeled>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink">Message</span>
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="link text-xs"
          >
            {showPreview ? "Back to editor" : "Preview email"}
          </button>
        </div>

        {showPreview ? (
          <div className="space-y-2">
            <div className="card px-3 py-2 text-sm">
              <span className="text-ink-faint">Subject: </span>
              <span className="text-ink">{previewSubject}</span>
              <span className="ml-2 text-xs text-ink-faint">
                {recipients[0]
                  ? `(personalised for ${recipients[0].email})`
                  : "(sample — select a recipient to personalise)"}
              </span>
            </div>
            <iframe
              title="Email preview"
              srcDoc={previewHtml}
              className="card h-[480px] w-full bg-white"
            />
          </div>
        ) : (
          <Editor value={body} onChange={setBody} />
        )}

        {topError && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {topError}
          </div>
        )}

        {results && (
          <div className="card space-y-2 p-4">
            {(() => {
              const ok = results.filter((r) => r.ok).length;
              const fail = results.length - ok;
              const total = sending ? sendTotal : results.length;
              const pct = total ? Math.round((results.length / total) * 100) : 0;
              return (
                <>
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-ink">
                      {sending
                        ? `Sending ${results.length}/${total}…`
                        : `Done — sent ${ok}/${results.length}`}
                      <span className="ml-2 text-xs font-normal text-ink-muted">
                        {ok} ✓{fail > 0 ? ` · ${fail} ✗` : ""}
                      </span>
                    </p>
                    {sending && (
                      <button
                        type="button"
                        onClick={stopSending}
                        className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100"
                      >
                        Stop
                      </button>
                    )}
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                    <div
                      className="h-full rounded-full bg-accent transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {sending && currentSend && (
                    <p className="text-xs text-ink-muted">Now sending: {currentSend}</p>
                  )}
                  <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                    {results.map((r, i) => (
                      <li
                        key={`${r.email}-${i}`}
                        className={r.ok ? "text-green-700" : "text-red-600"}
                      >
                        {r.ok ? "✓" : "✗"} {r.email}
                        {r.error ? ` — ${r.error}` : ""}
                      </li>
                    ))}
                  </ul>
                </>
              );
            })()}
          </div>
        )}
      </div>

      {/* Recipients sidebar */}
      <div className="space-y-3">
        <div className="card p-3.5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[13px] font-semibold text-ink">
              Recipients{" "}
              <span className="font-normal text-ink-faint">
                ({recipients.length})
              </span>
            </span>
            <div className="flex gap-1">
              <button
                onClick={() => selectWhere((c) => c.is_primary === 1)}
                className="chip"
                title="Select the best interview target per company (verified email only)"
              >
                Primary
              </button>
              <button
                onClick={() => selectWhere((c) => c.email_status === "valid")}
                className="chip"
                title="Select every contact with a verified-deliverable email"
              >
                Valid
              </button>
              <button
                onClick={() => selectWhere(() => true)}
                className="chip"
                title="Select every sendable contact, including risky / unknown emails"
              >
                All
              </button>
              <button onClick={() => setSelected(new Set())} className="chip">
                None
              </button>
            </div>
          </div>

          <p className="mb-2 text-xs text-ink-faint">
            {market ? (
              <>
                Showing {marketFlag(market)} {marketName(market)} contacts only.
              </>
            ) : (
              <>All countries — pick one in the header to narrow this list.</>
            )}
            {contactedCount > 0 && (
              <>
                {" "}
                <span className="text-ink-muted">
                  {contactedCount} already contacted (not selectable — see Follow-ups).
                </span>
              </>
            )}
          </p>

          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, company, title…"
            className="input mb-2 py-1.5"
          />

          <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={primaryOnly}
                onChange={(e) => setPrimaryOnly(e.target.checked)}
                className="accent-accent"
              />
              Primary target per company only
            </label>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input
                type="checkbox"
                checked={selectedOnly}
                onChange={(e) => setSelectedOnly(e.target.checked)}
                className="accent-accent"
              />
              Selected only{selected.size > 0 ? ` (${selected.size})` : ""}
            </label>
          </div>

          {cautionRecipients.length > 0 && (
            <p className="mb-2 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
              ⚠ {cautionRecipients.length} selected have a risky/unknown email — prefer
              LinkedIn for those.
            </p>
          )}

          <div className="max-h-[55vh] space-y-0.5 overflow-y-auto">
            {contactsError && (
              <p className="py-4 text-center text-xs text-red-500">{contactsError}</p>
            )}
            {!contactsError && visible.length === 0 && (
              <p className="py-4 text-center text-xs text-ink-faint">
                {selectedOnly
                  ? "No recipients selected yet."
                  : contacts.length === 0
                    ? "No researched contacts in the database yet."
                    : "No contacts match this filter."}
              </p>
            )}
            {visible.map((c) => {
              const st = statusOf(c.email_status);
              const sendable = selectableForInitial(c);
              const ob = outreachBadge(outreach.get(c.id), dueIds.has(c.id));
              return (
                <label
                  key={c.id}
                  className={`flex items-start gap-2 rounded-md px-2 py-1 transition ${
                    sendable ? "cursor-pointer hover:bg-paper" : "opacity-60"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    disabled={!sendable}
                    className="mt-0.5 accent-accent"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-sm text-ink">
                        {c.is_primary === 1 && (
                          <span
                            className="text-amber-500"
                            title="Best interview target for this company"
                          >
                            ★{" "}
                          </span>
                        )}
                        {c.name || c.email}
                      </span>
                      <span
                        className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}
                      >
                        {c.email ? st.label : "LinkedIn only"}
                      </span>
                      {ob && (
                        <span
                          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${ob.cls}`}
                        >
                          {ob.label}
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-ink-faint">
                      {[c.company, c.title].filter(Boolean).join(" · ") || c.email}
                    </span>
                    {!c.email && c.linkedin && (
                      <a
                        href={c.linkedin}
                        target="_blank"
                        rel="noreferrer"
                        className="link text-xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Open LinkedIn ↗
                      </a>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <Labeled label="Add emails directly" hint="Comma or space separated.">
          <textarea
            value={extra}
            onChange={(e) => setExtra(e.target.value)}
            rows={2}
            placeholder="someone@station.com"
            className="input"
          />
        </Labeled>

        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="btn-primary w-full py-3"
        >
          {sending
            ? `Sending… ${results?.length ?? 0}/${sendTotal}`
            : `Send to ${recipients.length} recipient${recipients.length === 1 ? "" : "s"}`}
        </button>
        <p className="text-center text-xs text-ink-faint">
          Each recipient receives a separate email (no shared To/CC).
        </p>
      </div>
    </div>
  );
}

function Labeled({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </label>
  );
}

function Banner({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      {children}
    </div>
  );
}
