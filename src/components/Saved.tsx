"use client";

import { useCallback, useEffect, useState } from "react";
import { statusOf } from "@/lib/contacts";
import { outreachBadge, type OutreachStatusRow } from "@/lib/outreach-ui";
import { useCountry } from "@/lib/country";
import { useLocalStorage } from "@/lib/store";
import SavedBoard from "./SavedBoard";
import type { Deal, StageId } from "@/lib/pipeline";

// Hand-picked contacts worth a future conversation (e.g. a polite decline from
// a senior person). Flag/unflag from the Contacts tab; review them here.
// An optional `opportunity` label groups several saved contacts (even across
// different companies) into a single opportunity card — one warm lead you work
// as a unit. See `setContactFlag` in lib/outreach.ts.
export type Flag = {
  contact_id: number;
  note: string | null;
  opportunity: string | null;
  stage: string | null;
  flagged_at: string;
  name: string;
  title: string | null;
  email: string | null;
  email_status: string | null;
  linkedin: string | null;
  is_primary: number | null;
  company: string | null;
  market: string | null;
};

type Opportunity = { key: string; label: string; items: Flag[] };

// Soft pastel tints for the bento tiles. The colour is picked from a stable
// seed (group label / contact id), so a tile keeps its colour across reloads
// and re-orders — colour is decoration, not meaning.
const TINTS = [
  "border-sky-200/70 bg-sky-50",
  "border-emerald-200/70 bg-emerald-50",
  "border-amber-200/70 bg-amber-50",
  "border-violet-200/70 bg-violet-50",
  "border-rose-200/70 bg-rose-50",
  "border-teal-200/70 bg-teal-50",
];

const hashSeed = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
};

const tintFor = (seed: number) => TINTS[seed % TINTS.length];

export default function SavedPanel() {
  const { market } = useCountry();
  const [flags, setFlags] = useState<Flag[]>([]);
  const [outreach, setOutreach] = useState<Map<number, OutreachStatusRow>>(new Map());
  const [dueIds, setDueIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // List = the bento grid; Board = the Kanban over the same deals.
  const [view, setView] = useLocalStorage<"list" | "board">("diems.saved.view", "list");

  // `quiet` re-fetches without flashing the loading state (used after a drag).
  const load = useCallback(
    (quiet = false) => {
      if (!quiet) setLoading(true);
      const qs = market ? `?market=${encodeURIComponent(market)}` : "";
      fetch(`/api/flags${qs}`)
        .then((r) => r.json())
        .then((d) => {
          if (d.error) setError(d.error);
          else setFlags((d.flags as Flag[]) || []);
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
        .finally(() => setLoading(false));
      fetch("/api/outreach/status")
        .then((r) => r.json())
        .then((d) => {
          const rows = (d.statuses as OutreachStatusRow[]) || [];
          setOutreach(new Map(rows.map((r) => [r.contact_id, r])));
          setDueIds(new Set((d.dueIds as number[]) || []));
        })
        .catch(() => {});
    },
    [market]
  );

  useEffect(() => {
    load();
  }, [load]);

  const post = async (contactId: number, body: Record<string, unknown>) => {
    await fetch("/api/flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, ...body }),
    }).catch(() => {});
    load();
  };

  const editNote = (f: Flag) => {
    const note = window.prompt("Why is this contact interesting?", f.note || "");
    if (note === null) return;
    post(f.contact_id, { note });
  };

  // Set / change / clear the opportunity this contact belongs to. Existing
  // labels are listed so it's easy to drop a contact into an existing group
  // (matching is case-insensitive + trimmed).
  const setGroup = (f: Flag) => {
    const existing = [
      ...new Set(flags.map((x) => (x.opportunity || "").trim()).filter(Boolean)),
    ];
    const hint = existing.length
      ? `\n\nExisting opportunities (reuse the exact name to merge):\n• ${existing.join(
          "\n• "
        )}`
      : "";
    const opportunity = window.prompt(
      `Group "${f.name}" under an opportunity name.\nLeave blank to ungroup.${hint}`,
      f.opportunity || ""
    );
    if (opportunity === null) return;
    post(f.contact_id, { opportunity });
  };

  const remove = (f: Flag) => {
    if (!window.confirm(`Remove ${f.name} from saved contacts?`)) return;
    fetch(`/api/flags?contactId=${f.contact_id}`, { method: "DELETE" })
      .then(() => load())
      .catch(() => {});
  };

  // Drag a deal to a new stage column (Board view). Optimistically restage every
  // contact in the deal, persist it, then — only for Lost / Replied, the two
  // stages with an exact email-engine meaning — halt or mark the sequence so a
  // dead deal stops getting follow-ups. Other stages never touch email status.
  const move = async (deal: Deal<Flag>, toStage: StageId) => {
    const ids = deal.contacts.map((c) => c.contact_id);
    const idSet = new Set(ids);
    setFlags((prev) =>
      prev.map((f) => (idSet.has(f.contact_id) ? { ...f, stage: toStage } : f))
    );
    try {
      const r = await fetch("/api/flags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactIds: ids, stage: toStage }),
      });
      if (!r.ok) return load(); // revert to server truth on failure
    } catch {
      return load();
    }

    if (toStage === "lost" || toStage === "replied") {
      const status = toStage === "lost" ? "stopped" : "replied";
      const active = deal.contacts.filter(
        (c) => outreach.get(c.contact_id)?.status === "active"
      );
      if (active.length) {
        await Promise.all(
          active.map((c) =>
            fetch("/api/outreach/mark", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contactId: c.contact_id, status }),
            }).catch(() => {})
          )
        );
        load(true); // refresh outreach badges without a spinner flash
      }
    }
  };

  // Split into opportunity groups (shared label) and ungrouped singles. `flags`
  // arrives newest-first, so first-seen order keeps the freshest leads on top.
  const groups: Opportunity[] = [];
  const singles: Flag[] = [];
  const byKey = new Map<string, Opportunity>();
  for (const f of flags) {
    const label = (f.opportunity || "").trim();
    if (!label) {
      singles.push(f);
      continue;
    }
    const key = label.toLowerCase();
    let g = byKey.get(key);
    if (!g) {
      g = { key, label, items: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.items.push(f);
  }

  const contactRow = (f: Flag) => {
    const st = statusOf(f.email_status);
    const ob = outreachBadge(outreach.get(f.contact_id), false);
    return (
      <div key={f.contact_id} className="min-w-0">
        {/* Identity — gets the full tile width; nothing competes for space */}
        <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
          <span className="break-words">{f.name}</span>
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}
          >
            {f.email ? st.label : "LinkedIn only"}
          </span>
          {ob && (
            <span
              className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${ob.cls}`}
            >
              {ob.label}
            </span>
          )}
        </p>
        {[f.company, f.title].filter(Boolean).length > 0 && (
          <p className="mt-0.5 text-xs text-ink-muted">
            {[f.company, f.title].filter(Boolean).join(" · ")}
          </p>
        )}
        {f.email && (
          <a
            href={`mailto:${f.email}`}
            className="mt-0.5 block break-words text-[13px] font-medium text-accent transition hover:underline"
          >
            {f.email}
          </a>
        )}
        {f.note && (
          <p className="mt-2 rounded-lg bg-white/60 px-3 py-2 text-[13px] leading-relaxed text-ink">
            {f.note}
          </p>
        )}
        {/* Actions — footer row that wraps instead of squeezing the content */}
        <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 border-t border-line/40 pt-2 text-xs">
          {f.linkedin && (
            <a
              href={f.linkedin}
              target="_blank"
              rel="noreferrer"
              className="rounded-md px-1.5 py-1 text-accent transition hover:bg-accent/10"
            >
              LinkedIn ↗
            </a>
          )}
          <button
            type="button"
            onClick={() => setGroup(f)}
            className="rounded-md px-1.5 py-1 text-ink-muted transition hover:bg-line/40 hover:text-ink"
            title={f.opportunity ? `Grouped: ${f.opportunity}` : "Group into an opportunity"}
          >
            {f.opportunity ? "Regroup" : "Group"}
          </button>
          <button
            type="button"
            onClick={() => editNote(f)}
            className="rounded-md px-1.5 py-1 text-ink-muted transition hover:bg-line/40 hover:text-ink"
          >
            Edit note
          </button>
          <button
            type="button"
            onClick={() => remove(f)}
            className="rounded-md px-1.5 py-1 text-ink-muted transition hover:bg-red-50 hover:text-red-600"
          >
            Remove
          </button>
          <span className="ml-auto shrink-0 text-[11px] text-ink-faint">
            {f.flagged_at.slice(0, 10)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`mx-auto space-y-4 ${view === "board" ? "max-w-7xl" : "max-w-5xl"}`}
    >
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight text-ink">Saved</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Contacts you&apos;ve marked as interesting for future conversations —
          declines worth revisiting, warm leads, people to circle back to. Flag
          them with the 🔖 button on the Contacts tab. Use <b>Group</b> to merge
          several contacts (even at different companies) into one opportunity.
        </p>
      </div>

      {!error && flags.length > 0 && (
        <div className="inline-flex rounded-lg bg-[#e9e9eb] p-0.5">
          {(["list", "board"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-[7px] px-3 py-1 text-[13px] capitalize transition ${
                view === v
                  ? "bg-surface font-medium text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
                  : "text-ink-muted hover:text-ink"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading && <p className="py-10 text-center text-sm text-ink-faint">Loading…</p>}
      {!loading && !error && flags.length === 0 && (
        <p className="py-10 text-center text-sm text-ink-faint">
          Nothing saved yet. Use 🔖 on the Contacts tab to keep someone here.
        </p>
      )}

      {view === "board" && flags.length > 0 && (
        <SavedBoard
          flags={flags}
          outreach={outreach}
          dueIds={dueIds}
          onMove={move}
        />
      )}

      {/* Bento masonry — opportunity + single tiles pack together regardless of
          height. CSS multi-columns keep varied-height cards gap-free. */}
      {view === "list" && (
      <div className="gap-3 sm:columns-2 lg:columns-3">
        {/* Opportunity cards — several saved contacts worked as one lead. */}
        {groups.map((g) => {
          const companies = [
            ...new Set(g.items.map((i) => i.company).filter(Boolean)),
          ];
          return (
            <div
              key={g.key}
              className={`card mb-3 break-inside-avoid p-3.5 ${tintFor(hashSeed(g.key))}`}
            >
              <div className="flex items-start justify-between gap-3 border-b border-line/60 pb-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink">{g.label}</p>
                  <p className="truncate text-xs text-ink-faint">
                    {g.items.length} contact{g.items.length === 1 ? "" : "s"}
                    {companies.length > 0 && ` · ${companies.join(" + ")}`}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] font-medium text-accent">
                  Opportunity
                </span>
              </div>
              <div className="mt-2 divide-y divide-line/50">
                {g.items.map((f) => (
                  <div key={f.contact_id} className="py-2.5 first:pt-0 last:pb-0">
                    {contactRow(f)}
                  </div>
                ))}
              </div>
            </div>
          );
        })}

        {/* Ungrouped saved contacts. */}
        {singles.map((f) => (
          <div
            key={f.contact_id}
            className={`card mb-3 break-inside-avoid p-3.5 ${tintFor(f.contact_id)}`}
          >
            {contactRow(f)}
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
