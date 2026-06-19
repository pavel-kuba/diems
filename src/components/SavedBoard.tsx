"use client";

import { useEffect, useState } from "react";
import { statusOf } from "@/lib/contacts";
import { outreachBadge, type OutreachStatusRow } from "@/lib/outreach-ui";
import {
  PIPELINE_STAGES,
  groupIntoDeals,
  type Deal,
  type StageId,
} from "@/lib/pipeline";
import type { Flag } from "./Saved";

// Kanban view of the saved deals. Cards are grouped by opportunity (else
// company); drag one between columns to set its manual `stage`. The email
// status (in sequence / due / replied) stays a separate badge — see
// `lib/pipeline.ts` for how a card's column is decided.
type Props = {
  flags: Flag[];
  outreach: Map<number, OutreachStatusRow>;
  dueIds: Set<number>;
  onMove: (deal: Deal<Flag>, toStage: StageId) => void;
};

export default function SavedBoard({ flags, outreach, dueIds, onMove }: Props) {
  const [dragging, setDragging] = useState<Deal<Flag> | null>(null);
  const [overStage, setOverStage] = useState<StageId | null>(null);
  const [openDeal, setOpenDeal] = useState<Deal<Flag> | null>(null);

  // Close the detail modal on Escape.
  useEffect(() => {
    if (!openDeal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenDeal(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openDeal]);

  const openStage = openDeal
    ? PIPELINE_STAGES.find((s) => s.id === openDeal.stage)
    : undefined;

  const deals = groupIntoDeals(flags, (id) => outreach.get(id)?.status);
  const byStage = (stage: StageId) => deals.filter((d) => d.stage === stage);

  const drop = (stage: StageId) => {
    if (dragging && dragging.stage !== stage) onMove(dragging, stage);
    setDragging(null);
    setOverStage(null);
  };

  const card = (deal: Deal<Flag>) => {
    const p = deal.primary;
    const st = statusOf(p.email_status);
    const ob = outreachBadge(outreach.get(p.contact_id), dueIds.has(p.contact_id));
    const more = deal.contacts.length - 1;
    const companies =
      deal.companies.length > 1 ? deal.companies.join(" + ") : null;
    return (
      <div
        key={deal.key}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = "move";
          setDragging(deal);
        }}
        onDragEnd={() => {
          setDragging(null);
          setOverStage(null);
        }}
        onClick={() => setOpenDeal(deal)}
        className={`card cursor-grab break-words p-3 transition hover:border-accent/40 active:cursor-grabbing ${
          dragging?.key === deal.key ? "opacity-50" : ""
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 text-[13px] font-semibold text-ink">{deal.title}</p>
          {deal.contacts.length > 1 && (
            <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {deal.contacts.length}
            </span>
          )}
        </div>

        <p className="mt-1 text-xs text-ink">
          <span className="font-medium">
            {p.is_primary ? "★ " : ""}
            {p.name}
          </span>
          {p.title && <span className="text-ink-muted"> · {p.title}</span>}
        </p>

        <div className="mt-1 flex flex-wrap items-center gap-1">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${st.cls}`}>
            {p.email ? st.label : "LinkedIn only"}
          </span>
          {ob && (
            <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${ob.cls}`}>
              {ob.label}
            </span>
          )}
        </div>

        {(companies || more > 0) && (
          <p className="mt-1 truncate text-[11px] text-ink-faint">
            {companies}
            {companies && more > 0 ? " · " : ""}
            {more > 0 ? `+${more} more contact${more === 1 ? "" : "s"}` : ""}
          </p>
        )}

        {p.note && (
          <p className="mt-1.5 line-clamp-3 rounded bg-white/60 px-2 py-1 text-[11px] leading-snug text-ink">
            {p.note}
          </p>
        )}

        <div className="mt-1.5 flex items-center gap-2 text-[11px]">
          {p.linkedin && (
            <a
              href={p.linkedin}
              target="_blank"
              rel="noreferrer"
              className="rounded px-1 py-0.5 text-accent transition hover:bg-accent/10"
              onClick={(e) => e.stopPropagation()}
            >
              LinkedIn ↗
            </a>
          )}
          <span className="ml-auto shrink-0 text-ink-faint">
            {p.flagged_at.slice(0, 10)}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div>
      <p className="mb-2 text-xs text-ink-faint">
        Drag a deal between columns to set its stage. Cards group by opportunity
        (else by company); the email-status badge is tracked separately.
      </p>
      <div
        className="grid gap-3"
        style={{
          gridTemplateColumns: `repeat(${PIPELINE_STAGES.length}, minmax(0, 1fr))`,
        }}
      >
        {PIPELINE_STAGES.map((stage) => {
          const items = byStage(stage.id);
          const over = overStage === stage.id;
          return (
            <div
              key={stage.id}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (overStage !== stage.id) setOverStage(stage.id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                drop(stage.id);
              }}
              className={`flex flex-col rounded-xl border p-2 transition ${
                over ? "border-accent/40 bg-accent/5" : stage.tint
              }`}
            >
              <div className="flex items-center justify-between gap-2 px-1 pb-2">
                <span className="text-[13px] font-semibold text-ink" title={stage.hint}>
                  {stage.label}
                </span>
                <span
                  className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${stage.chip}`}
                >
                  {items.length}
                </span>
              </div>
              <div className="flex min-h-16 flex-col gap-2">
                {items.length === 0 ? (
                  <p className="py-6 text-center text-[11px] text-ink-faint">
                    {over ? "Drop here" : "—"}
                  </p>
                ) : (
                  items.map(card)
                )}
              </div>
            </div>
          );
        })}
      </div>

      {openDeal && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4 sm:items-center"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpenDeal(null)}
        >
          <div
            className="card w-full max-w-lg p-5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-line/60 pb-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-ink">{openDeal.title}</h3>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {openDeal.companies.length > 0 &&
                    `${openDeal.companies.join(" + ")} · `}
                  {openDeal.contacts.length} contact
                  {openDeal.contacts.length === 1 ? "" : "s"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {openStage && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${openStage.chip}`}
                  >
                    {openStage.label}
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setOpenDeal(null)}
                  aria-label="Close"
                  className="rounded-md px-1.5 py-0.5 text-ink-muted transition hover:bg-line/40 hover:text-ink"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="divide-y divide-line/50">
              {openDeal.contacts.map((c) => {
                const st = statusOf(c.email_status);
                const ob = outreachBadge(
                  outreach.get(c.contact_id),
                  dueIds.has(c.contact_id)
                );
                const sub = [
                  c.title,
                  c.company && c.company !== openDeal.title ? c.company : null,
                ].filter(Boolean);
                return (
                  <div key={c.contact_id} className="py-3 first:pt-3 last:pb-0">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-ink">
                      <span className="break-words">
                        {c.is_primary ? "★ " : ""}
                        {c.name}
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
                    </p>
                    {sub.length > 0 && (
                      <p className="mt-0.5 text-xs text-ink-muted">{sub.join(" · ")}</p>
                    )}
                    {c.email && (
                      <a
                        href={`mailto:${c.email}`}
                        className="mt-0.5 block break-words text-[13px] font-medium text-accent transition hover:underline"
                      >
                        {c.email}
                      </a>
                    )}
                    {c.note && (
                      <p className="mt-2 whitespace-pre-wrap rounded-lg bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink">
                        {c.note}
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-3 text-[11px]">
                      {c.linkedin && (
                        <a
                          href={c.linkedin}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent transition hover:underline"
                        >
                          LinkedIn ↗
                        </a>
                      )}
                      <span className="ml-auto text-ink-faint">
                        saved {c.flagged_at.slice(0, 10)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
