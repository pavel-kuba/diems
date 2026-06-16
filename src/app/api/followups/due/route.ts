import { NextResponse } from "next/server";
import { getDueContacts } from "@/lib/outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Contacts who haven't replied and are due for their next follow-up step.
export async function GET(req: Request) {
  try {
    const market = (new URL(req.url).searchParams.get("market") || "").trim();
    const due = getDueContacts(new Date(), market);
    return NextResponse.json({ count: due.length, due });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg, due: [], count: 0 }, { status: 500 });
  }
}
