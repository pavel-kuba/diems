import { NextResponse } from "next/server";
import { markReplied, markStatus, type OutreachStatus } from "@/lib/outreach";

export const runtime = "nodejs";

// Manually set a contact's outreach state from the UI: stop a sequence (e.g.
// they replied / not interested), or resume it. Replies are tracked by hand.
type Payload = { contactId?: number; status?: string };

const ALLOWED = new Set<OutreachStatus>([
  "active", // resume — keeps current_step so the sequence continues
  "replied",
  "stopped",
]);

export async function POST(req: Request) {
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const contactId = Number(body.contactId);
  const status = body.status as OutreachStatus;
  if (!Number.isInteger(contactId) || contactId <= 0) {
    return NextResponse.json({ error: "Missing/invalid contactId." }, { status: 400 });
  }
  if (!ALLOWED.has(status)) {
    return NextResponse.json(
      { error: `status must be one of: ${[...ALLOWED].join(", ")}` },
      { status: 400 }
    );
  }

  try {
    // markReplied stamps replied_at; markStatus preserves current_step so
    // "active" resumes the sequence from where it left off.
    if (status === "replied") markReplied(contactId);
    else markStatus(contactId, status);
    return NextResponse.json({ ok: true, contactId, status });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
