/**
 * Saved-tab Kanban pipeline — client-safe config + grouping helpers.
 *
 * The board lays the same hand-flagged "deals" (see `contact_flags` in
 * `lib/outreach.ts`) out across manual stage columns. The stage is stored per
 * contact in `contact_flags.stage`; when it's NULL we derive a sensible default
 * from the contact's email-outreach status so the board isn't all in one column
 * before anything has been dragged.
 *
 * No server imports here — the Saved components import this directly (mirrors
 * `lib/outreach-ui.ts`).
 */

export type StageId = "replied" | "questions" | "won" | "lost";

export type Stage = {
  id: StageId;
  label: string;
  hint: string;
  /** Card border + background tint (matches the Saved bento pastels). */
  tint: string;
  /** Header count-chip classes. */
  chip: string;
};

// Ordered left-to-right. The board starts at Replied — saved deals are people
// already in conversation, not fresh leads.
export const PIPELINE_STAGES: Stage[] = [
  {
    id: "replied",
    label: "Replied",
    hint: "They responded — in conversation",
    tint: "border-violet-200/70 bg-violet-50",
    chip: "bg-violet-100 text-violet-700",
  },
  {
    id: "questions",
    label: "Interview Q&A",
    hint: "Interview questions sent — awaiting answers",
    tint: "border-amber-200/70 bg-amber-50",
    chip: "bg-amber-100 text-amber-700",
  },
  {
    id: "won",
    label: "Won",
    hint: "Interview done / published",
    tint: "border-emerald-200/70 bg-emerald-50",
    chip: "bg-emerald-100 text-emerald-700",
  },
  {
    id: "lost",
    label: "Lost",
    hint: "Declined / no-go / dead",
    tint: "border-rose-200/70 bg-rose-50",
    chip: "bg-rose-100 text-rose-700",
  },
];

const STAGE_IDS = new Set<string>(PIPELINE_STAGES.map((s) => s.id));

export function isStageId(s: string | null | undefined): s is StageId {
  return !!s && STAGE_IDS.has(s);
}

/**
 * Seed a stage from a contact's email-outreach status (used only when the deal
 * has no explicit `stage` yet). The board starts at Replied — saved deals are
 * people already in conversation — so anything not negatively halted floors to
 * "replied". Only a manual `stopped` (a decline / no-go) seeds "Lost".
 * `bounced`/`unsubscribed` aren't opportunities and are excluded from the Saved
 * board entirely (see `listContactFlags`), so they never reach here. "Interview
 * Q&A" and "Won" have no email-engine equivalent and are only reached by dragging.
 */
export function defaultStageFor(status: string | null | undefined): StageId {
  return status === "stopped" ? "lost" : "replied";
}

/** Minimal shape `groupIntoDeals` needs — a superset is fine (kept generic). */
export type DealFlag = {
  contact_id: number;
  name: string;
  company: string | null;
  opportunity: string | null;
  is_primary: number | null;
  stage: string | null;
};

export type Deal<T extends DealFlag = DealFlag> = {
  key: string;
  title: string;
  companies: string[];
  /** Contacts in this deal, ★ primary first. */
  contacts: T[];
  /** Representative contact (primary if any, else the freshest flag). */
  primary: T;
  /** Effective column: the persisted stage, else seeded from outreach status. */
  stage: StageId;
  /** Whether the stage is persisted (vs. a seeded default). */
  explicitStage: StageId | null;
};

/**
 * Collapse flagged contacts into deal cards: group by `opportunity` label if set
 * (case-insensitive), else by company, else stand alone. Input order is preserved
 * (flags arrive newest-first), and a deal's stage is the first persisted stage
 * among its members (★ primary preferred), else a default seeded from the
 * representative contact's outreach status via `statusFor`.
 */
export function groupIntoDeals<T extends DealFlag>(
  flags: T[],
  statusFor: (contactId: number) => string | null | undefined
): Deal<T>[] {
  const byKey = new Map<string, T[]>();
  const order: string[] = [];
  for (const f of flags) {
    const opp = (f.opportunity || "").trim();
    const key = opp
      ? `opp:${opp.toLowerCase()}`
      : f.company
        ? `co:${f.company.toLowerCase()}`
        : `c:${f.contact_id}`;
    let arr = byKey.get(key);
    if (!arr) {
      arr = [];
      byKey.set(key, arr);
      order.push(key);
    }
    arr.push(f);
  }

  return order.map((key) => {
    const items = byKey.get(key)!;
    // Stable sort keeps newest-first order among equal `is_primary`.
    const contacts = [...items].sort(
      (a, b) => (b.is_primary ?? 0) - (a.is_primary ?? 0)
    );
    const primary = contacts[0];
    const opp = (primary.opportunity || "").trim();
    const companies = [
      ...new Set(contacts.map((c) => c.company).filter(Boolean)),
    ] as string[];
    const title = opp || primary.company || primary.name;
    const explicitRaw = contacts.find((c) => c.stage)?.stage ?? null;
    const explicitStage = isStageId(explicitRaw) ? explicitRaw : null;
    const stage = explicitStage ?? defaultStageFor(statusFor(primary.contact_id));
    return { key, title, companies, contacts, primary, stage, explicitStage };
  });
}
