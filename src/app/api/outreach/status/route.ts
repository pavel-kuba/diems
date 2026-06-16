import { NextResponse } from "next/server";
import { allOutreachStatus, getDueContacts } from "@/lib/outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-contact outreach state for UI badges (Contacts tab) + a set of contact
// ids currently due for a follow-up. Calling this also ensures the outreach
// tables exist (the writable handle migrates on first open).
export async function GET() {
  try {
    const rows = allOutreachStatus();
    const dueIds = getDueContacts(new Date()).map((d) => d.contact_id);
    return NextResponse.json({ statuses: rows, dueIds });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg, statuses: [], dueIds: [] }, { status: 500 });
  }
}
