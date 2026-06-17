"use client";

import { useEffect, useState } from "react";
import { useLocalStorage } from "@/lib/store";
import type { DBContact } from "@/lib/contacts";

/* ------------------------------------------------------------------ */
/* Copy-and-send message templates. Look up a recipient (or type the   */
/* details), and each message auto-fills the merge tags. The body is    */
/* light markup (**bold**, "1." → numbered list, "- " → bullets); the  */
/* preview renders it, and Copy puts BOTH rich HTML and plain text on   */
/* the clipboard so a paste into Superhuman / Gmail keeps the bold      */
/* labels and lists. Nothing is sent automatically. Templates persist   */
/* to localStorage.                                                     */
/* ------------------------------------------------------------------ */

type MsgTemplate = { subject: string; body: string };
type TemplateId = "claim" | "questions";
type Templates = Record<TemplateId, MsgTemplate>;

const TPL_KEY = "diems.msg-templates.v3";

const DEFAULTS: Templates = {
  claim: {
    subject: "Your [Company] profile on Monitoring Station Guide",
    body: `Hi [First Name],

Thanks for claiming the [Company] profile on Monitoring Station Guide — it came through on our side. (Monitoring Station Guide is our directory here at Angelcam, which is why this is coming from me.)

Before I approve the claim and set it live as verified, could you give the current listing a quick look so I publish the right details? Here's what we have today:

**Company:** [Company]
**Website:** [Website]
**Location:** [Location]
**Listing contact:** [Listing Contact]
**Current description:** [Description]

Capabilities:

- Video verification ([Video Verification])
- Active deterrence ([Active Deterrence])
- Brand agnosticity ([Brand Agnosticity])

Three quick things would really help:

1. **Is everything above accurate?** Flag anything that's off.
2. **What would you most like to change, add, or improve?** — the description, the services listed, the logo, the contact shown, anything at all.
3. **Can you verify the capabilities?** Video verification means your operators can verify alarms using security cameras in real time. Active deterrence means your operators can trigger a deterrent (voice talk-down, fog machine, …). Brand agnosticity means your operators can verify alarms from almost any security camera (at Angelcam — our camera platform — we support over 200 camera brands).

A few notes back in a reply is perfect, and I'll get the edits applied and the claim approved.

Once the profile's looking the way you want it, I'd still love to line up the short Q&A I mentioned for the blog — but no rush; let's get your listing right first.

Best,
Pavel`,
  },
  questions: {
    subject: "Questions for the [Company] feature",
    body: `Hi [First Name],

Thanks so much — great to hear you're interested, and thanks for picking this up.

Here are the questions for review. As much or as little detail as you like — even a couple of sentences each is perfect.

1. **Intro** — Tell us a bit about [Company]: who you serve and what your monitoring operation looks like today.
2. **What sets you apart** — What makes [Company] different from other monitoring stations? When a customer chooses you over a competitor, what's usually the deciding factor?
3. **Ideal customer** — Who is your ideal customer, and what do you do best for them — the thing that keeps them with you?
4. **Response time** — From the moment an alarm is triggered, what's your typical response time — how fast does an operator actually start acting on the signal?
5. **Resolution time** — And how about resolution — from alarm to a handled/closed incident, what does a typical timeline look like?
6. **Video verification & deterrence** — How easy is it for a customer to add active deterrence (e.g. audio talk-down / warnings) to their service? Is that something your operators can do directly, and how does a customer get set up for it?
7. **Camera-brand connectivity** — Do you work with multiple camera brands, or are customers tied to specific hardware? How do cameras typically connect to your monitoring centre?
8. **False alarms** — How do you keep false alarms down, and how much does video verification help there?
9. **How you work with customers** — Can someone buy standalone 24/7 monitoring as a service? And how flexible is it — for example, could someone get monitoring just while they're away on holiday, or is it always a longer commitment? What does the process look like?
10. **Advice to buyers** — If someone is shopping for a monitoring station, what should they look for, and what questions should they ask?

Whenever you have a chance to put something together over this or next week would be perfect — no rush. And of course, I'll send you the finished piece to review and approve before it goes live.

Thanks again,
Pavel`,
  },
};

type Vars = {
  firstName: string;
  company: string;
  email: string;
  website: string;
  location: string;
  listingContact: string;
  description: string;
  caps: { video: boolean; active: boolean; brand: boolean };
};

const yn = (b: boolean) => (b ? "yes" : "no");

const fillWith = (s: string, v: Vars) =>
  s
    .replaceAll("[First Name]", v.firstName.trim() || "there")
    .replaceAll("[Name]", v.firstName.trim() || "there")
    .replaceAll("[Company]", v.company.trim() || "your company")
    .replaceAll("[Email]", v.email.trim())
    .replaceAll("[Website]", v.website.trim() || "—")
    .replaceAll("[Location]", v.location.trim() || "—")
    .replaceAll("[Listing Contact]", v.listingContact.trim() || "—")
    .replaceAll("[Description]", v.description.trim() || "—")
    .replaceAll("[Video Verification]", yn(v.caps.video))
    .replaceAll("[Active Deterrence]", yn(v.caps.active))
    .replaceAll("[Brand Agnosticity]", yn(v.caps.brand));

/* --- light markup → HTML (paragraphs, **bold**, ordered/bulleted lists) --- */
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const inline = (s: string) =>
  esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

function mdToHtml(text: string): string {
  return text
    .trim()
    .split(/\n{2,}/)
    .map((block) => {
      const lines = block.split("\n").filter((l) => l.trim() !== "");
      if (lines.length && lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
        return `<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+\.\s+/, ""))}</li>`).join("")}</ol>`;
      }
      if (lines.length && lines.every((l) => /^\s*[-•]\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      return `<p>${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

const mdToPlain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1");

export default function TemplatesPanel() {
  const [tpl, setTpl] = useLocalStorage<Templates>(TPL_KEY, DEFAULTS);

  const [firstName, setFirstName] = useState("");
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState("");
  const [location, setLocation] = useState("");
  const [listingContact, setListingContact] = useState("");
  const [description, setDescription] = useState("");
  const [caps, setCaps] = useState({ video: true, active: true, brand: false });

  // Recipient lookup against the DB contacts directory.
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DBContact[]>([]);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return; // dropdown is gated on query length below
    const t = setTimeout(() => {
      fetch(`/api/contacts?q=${encodeURIComponent(q)}`)
        .then((r) => r.json())
        .then((d) => setResults(((d.contacts as DBContact[]) || []).slice(0, 8)))
        .catch(() => setResults([]));
    }, 220);
    return () => clearTimeout(t);
  }, [query]);

  const pick = (c: DBContact) => {
    setFirstName(c.first_name || c.name?.split(/\s+/)[0] || "");
    setCompany(c.company || "");
    setEmail(c.email || "");
    setWebsite(c.company_website || "");
    setLocation([c.company_city, c.company_region].filter(Boolean).join(", "));
    setDescription(c.company_description || "");
    setListingContact([c.name, c.title, c.email].filter(Boolean).join(" — "));
    setQuery("");
    setResults([]);
  };

  const vars: Vars = {
    firstName, company, email, website, location, listingContact, description, caps,
  };

  const update = (id: TemplateId, patch: Partial<MsgTemplate>) =>
    setTpl((t) => ({ ...t, [id]: { ...t[id], ...patch } }));
  const reset = (id: TemplateId) => setTpl((t) => ({ ...t, [id]: DEFAULTS[id] }));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight text-ink">Templates</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Look up a recipient (or type the details), and each message auto-fills.
          <b> Copy message</b> puts formatted text on the clipboard — paste into
          your inbox and the bold labels and lists carry over. Nothing is sent
          automatically.
        </p>
      </div>

      {/* Recipient + listing details */}
      <div className="card space-y-4 p-4">
        {/* Lookup */}
        <div className="relative">
          <p className="text-xs font-medium text-ink-muted">Look up a contact</p>
          <input
            className="input mt-1"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, company, or email…"
          />
          {query.trim().length >= 2 && results.length > 0 && (
            <ul className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
              {results.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => pick(c)}
                    className="flex w-full flex-col items-start px-3 py-1.5 text-left hover:bg-paper"
                  >
                    <span className="text-[13px] font-medium text-ink">
                      {c.name}
                      {c.is_primary ? " ★" : ""}
                    </span>
                    <span className="text-[11px] text-ink-faint">
                      {[c.company, c.email].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Core fields */}
        <div className="grid gap-3 sm:grid-cols-3">
          <LabeledInput label="First name" value={firstName} onChange={setFirstName} placeholder="Naomi" />
          <LabeledInput label="Company" value={company} onChange={setCompany} placeholder="iGuard360°" />
          <LabeledInput label="Email (to send to)" value={email} onChange={setEmail} placeholder="naomi@iguard.ca" />
        </div>

        {/* Listing details (profile-claim only) */}
        <details className="group">
          <summary className="cursor-pointer list-none text-xs font-medium text-ink-muted">
            <span className="text-ink-faint group-open:hidden">▸ </span>
            <span className="hidden text-ink-faint group-open:inline">▾ </span>
            Company listing details — used by the profile-claim message
          </summary>
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <LabeledInput label="Website" value={website} onChange={setWebsite} placeholder="https://iguard360.com" />
              <LabeledInput label="Location" value={location} onChange={setLocation} placeholder="Mississauga, Ontario" />
            </div>
            <LabeledInput
              label="Listing contact"
              value={listingContact}
              onChange={setListingContact}
              placeholder="Naomi Maharaj — Director, Sales & Marketing — naomi@iguard.ca"
            />
            <label className="block">
              <span className="text-[11px] text-ink-faint">Current description</span>
              <textarea
                className="input mt-1 min-h-[80px] leading-relaxed"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What we have on file for this company…"
              />
            </label>
            <div>
              <span className="text-[11px] text-ink-faint">Capabilities on file</span>
              <div className="mt-1 flex flex-wrap gap-2">
                <Toggle label="Video verification" on={caps.video} onClick={() => setCaps((c) => ({ ...c, video: !c.video }))} />
                <Toggle label="Active deterrence" on={caps.active} onClick={() => setCaps((c) => ({ ...c, active: !c.active }))} />
                <Toggle label="Brand agnosticity" on={caps.brand} onClick={() => setCaps((c) => ({ ...c, brand: !c.brand }))} />
              </div>
            </div>
          </div>
        </details>
      </div>

      <TemplateCard
        title="Profile claim"
        description="Send when someone claims their company profile."
        value={tpl.claim}
        vars={vars}
        onChange={(p) => update("claim", p)}
        onReset={() => reset("claim")}
      />
      <TemplateCard
        title="Interview questions"
        description="Send to people who respond favourably."
        value={tpl.questions}
        vars={vars}
        onChange={(p) => update("questions", p)}
        onReset={() => reset("questions")}
      />
    </div>
  );
}

function TemplateCard({
  title,
  description,
  value,
  vars,
  onChange,
  onReset,
}: {
  title: string;
  description: string;
  value: MsgTemplate;
  vars: Vars;
  onChange: (patch: Partial<MsgTemplate>) => void;
  onReset: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const filledSubject = fillWith(value.subject, vars);
  const filledBody = fillWith(value.body, vars);
  const bodyHtml = mdToHtml(filledBody);

  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3 border-b border-line/50 pb-2.5">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <p className="text-xs text-ink-faint">{description}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {editing && (
            <button type="button" onClick={onReset} className="chip">
              Reset
            </button>
          )}
          <button type="button" onClick={() => setEditing((e) => !e)} className="chip">
            {editing ? "Done" : "Edit"}
          </button>
        </div>
      </div>

      {editing ? (
        <div className="mt-3 space-y-3">
          <label className="block">
            <span className="text-[11px] text-ink-faint">Subject</span>
            <input
              className="input mt-1"
              value={value.subject}
              onChange={(e) => onChange({ subject: e.target.value })}
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-ink-faint">Message</span>
            <textarea
              className="input mt-1 min-h-[320px] font-mono leading-relaxed"
              value={value.body}
              onChange={(e) => onChange({ body: e.target.value })}
            />
          </label>
          <p className="text-[11px] leading-relaxed text-ink-faint">
            Formatting: <code className="rounded bg-line/50 px-1">**bold**</code>,
            lines starting <code className="rounded bg-line/50 px-1">1.</code> become
            a numbered list, <code className="rounded bg-line/50 px-1">-</code> become
            bullets (blank line separates blocks). Merge tags:{" "}
            <code className="rounded bg-line/50 px-1">[First Name]</code>{" "}
            <code className="rounded bg-line/50 px-1">[Company]</code>{" "}
            <code className="rounded bg-line/50 px-1">[Website]</code>{" "}
            <code className="rounded bg-line/50 px-1">[Location]</code>{" "}
            <code className="rounded bg-line/50 px-1">[Listing Contact]</code>{" "}
            <code className="rounded bg-line/50 px-1">[Description]</code>{" "}
            <code className="rounded bg-line/50 px-1">[Video Verification]</code>{" "}
            <code className="rounded bg-line/50 px-1">[Active Deterrence]</code>{" "}
            <code className="rounded bg-line/50 px-1">[Brand Agnosticity]</code>
          </p>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-ink-faint">Subject</span>
              <CopyButton text={filledSubject} label="Copy" />
            </div>
            <p className="mt-1 rounded-lg bg-paper px-3 py-2 text-[13px] text-ink">
              {filledSubject}
            </p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-ink-faint">Message (formatted)</span>
              <CopyButton text={mdToPlain(filledBody)} html={bodyHtml} label="Copy message" primary />
            </div>
            <div
              className="prose-email mt-1 rounded-lg bg-paper px-3 py-2.5 text-[13px] leading-relaxed text-ink"
              dangerouslySetInnerHTML={{ __html: bodyHtml }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] text-ink-faint">{label}</span>
      <input
        className="input mt-1"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-[12px] font-medium transition ${
        on
          ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200/70"
          : "bg-line/40 text-ink-muted hover:bg-line/60"
      }`}
    >
      {label}: {on ? "yes" : "no"}
    </button>
  );
}

function CopyButton({
  text,
  html,
  label,
  primary,
}: {
  text: string;
  html?: string;
  label: string;
  primary?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      if (html && "ClipboardItem" in window && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className={primary ? "btn-primary text-[12px]" : "chip"}
    >
      {copied ? "Copied ✓" : label}
    </button>
  );
}
