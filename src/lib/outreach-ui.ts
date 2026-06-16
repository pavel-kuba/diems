// Client-safe helpers for displaying outreach state (no server imports).
// Shape mirrors /api/outreach/status rows.

export type OutreachStatusRow = {
  contact_id: number;
  status: string;
  current_step: number;
  thread_message_id: string | null;
  replied_at: string | null;
  last_sent_at: string | null;
};

export type OutreachBadge = { label: string; cls: string };

const STEP_LABEL = ["initial sent", "bumped (1/3)", "bumped (2/3)", "break-up sent"];

/** Badge for a contact's outreach state. `due` = currently due for a follow-up. */
export function outreachBadge(
  row: OutreachStatusRow | undefined,
  due: boolean
): OutreachBadge | null {
  if (!row) return null; // never contacted → no badge
  switch (row.status) {
    case "replied":
      return { label: "replied ✓", cls: "bg-emerald-100 text-emerald-800" };
    case "stopped":
      return { label: "stopped", cls: "bg-stone-200 text-stone-600" };
    case "bounced":
      return { label: "bounced", cls: "bg-red-100 text-red-700" };
    case "unsubscribed":
      return { label: "unsubscribed", cls: "bg-stone-200 text-stone-600" };
    case "completed":
      return { label: "sequence done", cls: "bg-stone-200/70 text-stone-500" };
    case "active":
    default:
      if (due) return { label: "follow-up due", cls: "bg-accent/10 text-accent" };
      return {
        label: STEP_LABEL[row.current_step] || "in sequence",
        cls: "bg-stone-200/70 text-stone-500",
      };
  }
}
