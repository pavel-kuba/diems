"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { statusOf, type DBContact } from "@/lib/contacts";
import { outreachBadge, type OutreachStatusRow } from "@/lib/outreach-ui";
import { useCountry } from "@/lib/country";

// The three deliverability buckets the summary pills count — and now filter by.
type EmailCategory = "valid" | "caution" | "noEmail";
function categoryOf(c: DBContact): EmailCategory {
  const st = statusOf(c.email_status);
  if (!c.email || !st.sendable) return "noEmail";
  if (st.caution) return "caution";
  return "valid";
}

// Read-only view of the researched decision-makers stored in SQLite
// (data/monitoring.db, served by /api/contacts). Contacts are created/updated by
// the research-contacts skill + scripts/save-contacts.mjs — not edited here.
export default function ContactsPanel() {
  const { market } = useCountry();
  const [contacts, setContacts] = useState<DBContact[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [primaryOnly, setPrimaryOnly] = useState(false);
  const [emailFilter, setEmailFilter] = useState<EmailCategory | null>(null);
  const [outreach, setOutreach] = useState<Map<number, OutreachStatusRow>>(new Map());
  const [dueIds, setDueIds] = useState<Set<number>>(new Set());
  const [flagged, setFlagged] = useState<Set<number>>(new Set());

  useEffect(() => {
    setLoading(true);
    const qs = market ? `?market=${encodeURIComponent(market)}` : "";
    fetch(`/api/contacts${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        setContacts((d.contacts as DBContact[]) || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load contacts"))
      .finally(() => setLoading(false));
  }, [market]);

  const loadOutreach = useCallback(() => {
    fetch("/api/outreach/status")
      .then((r) => r.json())
      .then((d) => {
        const rows = (d.statuses as OutreachStatusRow[]) || [];
        setOutreach(new Map(rows.map((r) => [r.contact_id, r])));
        setDueIds(new Set((d.dueIds as number[]) || []));
      })
      .catch(() => {
        /* outreach status is non-critical for the directory view */
      });
  }, []);

  const loadFlags = useCallback(() => {
    fetch("/api/flags")
      .then((r) => r.json())
      .then((d) => {
        const rows = (d.flags as { contact_id: number }[]) || [];
        setFlagged(new Set(rows.map((f) => f.contact_id)));
      })
      .catch(() => {
        /* flags are non-critical for the directory view */
      });
  }, []);

  useEffect(() => {
    loadOutreach();
    loadFlags();
  }, [loadOutreach, loadFlags]);

  // Save a contact as "interesting for the future" (Saved tab), or remove it.
  const toggleFlag = async (id: number, name: string) => {
    if (flagged.has(id)) {
      if (!window.confirm(`Remove ${name} from saved contacts?`)) return;
      await fetch(`/api/flags?contactId=${id}`, { method: "DELETE" }).catch(() => {});
    } else {
      const note = window.prompt(
        `Why is ${name} interesting? (shown on the Saved tab)`,
        ""
      );
      if (note === null) return;
      await fetch("/api/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: id, note }),
      }).catch(() => {});
    }
    loadFlags();
  };

  // Manually stop a sequence (replied / not interested) or resume it.
  const mark = async (id: number, status: "stopped" | "active") => {
    await fetch("/api/outreach/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: id, status }),
    }).catch(() => {});
    loadOutreach();
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts.filter((c) => {
      if (primaryOnly && c.is_primary !== 1) return false;
      if (emailFilter && categoryOf(c) !== emailFilter) return false;
      if (!q) return true;
      return [c.name, c.email, c.company, c.title].some((v) =>
        (v || "").toLowerCase().includes(q)
      );
    });
  }, [contacts, query, primaryOnly, emailFilter]);

  // Group by company, preserving the API's order (company, primary first, name).
  const groups = useMemo(() => {
    const map = new Map<string, DBContact[]>();
    for (const c of filtered) {
      const key = c.company || "(unmatched)";
      (map.get(key) ?? map.set(key, []).get(key)!).push(c);
    }
    return [...map.entries()];
  }, [filtered]);

  const stats = useMemo(() => {
    let valid = 0,
      caution = 0,
      noEmail = 0;
    for (const c of contacts) {
      const cat = categoryOf(c);
      if (cat === "valid") valid++;
      else if (cat === "caution") caution++;
      else noEmail++;
    }
    return { valid, caution, noEmail };
  }, [contacts]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">
          Contacts
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          {contacts.length} researched decision-maker
          {contacts.length === 1 ? "" : "s"} across{" "}
          {new Set(contacts.map((c) => c.company)).size} companies — read-only.
          Managed by the research scripts; selectable in the Compose tab.
        </p>
        {contacts.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <FilterPill
              cls="bg-emerald-100 text-emerald-800"
              active={emailFilter === "valid"}
              dimmed={emailFilter !== null && emailFilter !== "valid"}
              onClick={() => setEmailFilter((f) => (f === "valid" ? null : "valid"))}
            >
              {stats.valid} valid
            </FilterPill>
            <FilterPill
              cls="bg-amber-100 text-amber-800"
              active={emailFilter === "caution"}
              dimmed={emailFilter !== null && emailFilter !== "caution"}
              onClick={() => setEmailFilter((f) => (f === "caution" ? null : "caution"))}
            >
              {stats.caution} risky / unknown
            </FilterPill>
            <FilterPill
              cls="bg-stone-200/70 text-stone-500"
              active={emailFilter === "noEmail"}
              dimmed={emailFilter !== null && emailFilter !== "noEmail"}
              onClick={() => setEmailFilter((f) => (f === "noEmail" ? null : "noEmail"))}
            >
              {stats.noEmail} LinkedIn-only / invalid
            </FilterPill>
            {emailFilter && (
              <button
                type="button"
                onClick={() => setEmailFilter(null)}
                className="text-ink-faint underline-offset-2 hover:text-ink hover:underline"
              >
                Clear
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, company, title, email…"
          className="input"
        />
        <label className="flex shrink-0 items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={primaryOnly}
            onChange={(e) => setPrimaryOnly(e.target.checked)}
            className="accent-accent"
          />
          ★ Primary only
        </label>
      </div>

      {loading && <p className="py-10 text-center text-sm text-ink-faint">Loading…</p>}
      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {!loading && !error && groups.length === 0 && (
        <p className="py-10 text-center text-sm text-ink-faint">
          {contacts.length === 0
            ? "No researched contacts yet. Run the research-contacts skill."
            : "No contacts match this filter."}
        </p>
      )}

      <div className="space-y-3">
        {groups.map(([company, rows]) => (
          <div key={company} className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-line/60 bg-paper/70 px-4 py-1.5">
              <span className="truncate text-[13px] font-semibold text-ink">
                {company}
              </span>
              <span className="shrink-0 text-xs text-ink-faint">
                {rows.length} contact{rows.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="divide-y divide-line/70">
              {rows.map((c) => {
                const st = statusOf(c.email_status);
                const orow = outreach.get(c.id);
                const ob = outreachBadge(orow, dueIds.has(c.id));
                return (
                  <div key={c.id} className="flex items-start justify-between gap-3 px-4 py-2">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
                        {c.is_primary === 1 && (
                          <span
                            className="text-amber-500"
                            title="Best interview target for this company"
                          >
                            ★
                          </span>
                        )}
                        <span className="truncate">{c.name}</span>
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
                      </p>
                      {c.title && <p className="truncate text-xs text-ink-muted">{c.title}</p>}
                      <p className="truncate text-xs text-ink-faint">
                        {c.email ? (
                          <>
                            {c.email}
                            {c.email_confidence != null ? ` · ${c.email_confidence}%` : ""}
                            {c.email_type ? ` · ${c.email_type}` : ""}
                          </>
                        ) : (
                          "no verified email"
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => toggleFlag(c.id, c.name)}
                        className={`rounded-md px-2 py-1 text-xs transition ${
                          flagged.has(c.id)
                            ? "bg-amber-50 text-amber-700 hover:bg-amber-100"
                            : "text-ink-muted hover:bg-line/40 hover:text-ink"
                        }`}
                        title={
                          flagged.has(c.id)
                            ? "Saved for future conversations — click to remove"
                            : "Save as interesting for a future conversation"
                        }
                      >
                        {flagged.has(c.id) ? "🔖 Saved" : "🔖 Save"}
                      </button>
                      {c.linkedin && (
                        <a
                          href={c.linkedin}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded-md px-2 py-1 text-xs text-accent transition hover:bg-accent/10"
                        >
                          LinkedIn ↗
                        </a>
                      )}
                      {orow?.status === "active" && (
                        <button
                          type="button"
                          onClick={() => mark(c.id, "stopped")}
                          className="rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-red-50 hover:text-red-600"
                          title="Stop the follow-up sequence (replied / not interested)"
                        >
                          Stop sequence
                        </button>
                      )}
                      {(orow?.status === "stopped" || orow?.status === "replied") && (
                        <button
                          type="button"
                          onClick={() => mark(c.id, "active")}
                          className="rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-accent/10 hover:text-accent"
                          title="Resume the follow-up sequence"
                        >
                          Resume
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// A summary count that doubles as a toggle filter for the live list. Click to
// show only that bucket; click again (or "Clear") to show everything.
function FilterPill({
  cls,
  active,
  dimmed,
  onClick,
  children,
}: {
  cls: string;
  active: boolean;
  dimmed: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      title={active ? "Filtering by this — click to clear" : "Click to filter the list"}
      className={`rounded px-2 py-0.5 font-medium transition ${cls} ${
        active ? "ring-2 ring-current" : ""
      } ${dimmed ? "opacity-40 hover:opacity-100" : "hover:opacity-80"}`}
    >
      {children}
    </button>
  );
}
