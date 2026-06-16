/**
 * The follow-up sequence — config as code (not a DB table).
 *
 * Step 0 is the initial email, composed + sent from the Compose tab (its body
 * is the editable DEFAULT_BODY in Composer.tsx). Steps 1..3 are the automated
 * follow-ups sent by /api/followups/send to contacts who haven't replied:
 *
 *   step 1  +2 days   gentle bump
 *   step 2  +5 days   new-angle nudge
 *   step 3  +10 days  break-up ("closing the loop")
 *
 * Offsets are days SINCE THE INITIAL SEND; the engine waits the gap between a
 * contact's current step and the next. Follow-ups thread under the original
 * (In-Reply-To/References + a "Re: <original subject>" subject), so they nest
 * in the recipient's existing conversation and stay short.
 */

import { SIGNATURE_HTML } from "@/lib/signature";

// Day offset from the initial send for each step index (0, 2, 5, 10 days).
export const STEP_OFFSETS_DAYS = [0, 2, 5, 10] as const;

// Index of the final step (the break-up). After this a contact is `completed`.
export const MAX_STEP = 3;

/** Follow-up bodies by step (1..3). Reuse [First Name] / [Company] merge tags. */
export const FOLLOWUP_BODIES: Record<number, string> = {
  1:
    "<p>Hi [First Name],</p>" +
    "<p>No worries if the timing's off — just didn't want this to get buried. " +
    "Even a quick yes/no helps, and I'll keep it short and fully async if you're up for it.</p>" +
    "<p>Best,</p>" +
    SIGNATURE_HTML,
  2:
    "<p>Hi [First Name],</p>" +
    "<p>One more nudge on this. The interviews we've published are getting good " +
    "traction with monitoring-industry readers, and featuring [Company] would put " +
    "you in front of that audience. It's about 20 minutes (or fully async), and you " +
    "approve every quote before anything goes live.</p>" +
    "<p>Worth a quick yes/no?</p>" +
    "<p>Best,</p>" +
    SIGNATURE_HTML,
  3:
    "<p>Hi [First Name],</p>" +
    "<p>I'll close the loop here so I'm not cluttering your inbox — I'll assume the " +
    "timing isn't right for an interview about [Company]. If that changes down the " +
    "line, just reply to this thread and we'll pick it up.</p>" +
    "<p>Thanks either way,</p>" +
    SIGNATURE_HTML,
};

/** "Re:"-prefix the original subject (without doubling an existing "Re:"). */
export function followupSubject(originalSubject: string): string {
  const base = (originalSubject || "").replace(/^\s*re:\s*/i, "").trim();
  return base ? `Re: ${base}` : "Re:";
}
