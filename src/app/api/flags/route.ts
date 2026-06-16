import { NextResponse } from "next/server";
import {
  listContactFlags,
  setContactFlag,
  clearContactFlag,
} from "@/lib/outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Saved contacts — hand-picked people worth a future conversation.
export async function GET(req: Request) {
  try {
    const market = (new URL(req.url).searchParams.get("market") || "").trim();
    return NextResponse.json({ flags: listContactFlags(market) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg, flags: [] }, { status: 500 });
  }
}

// Flag a contact (or update its note / opportunity): { contactId, note?, opportunity? }
// Only the fields present in the body are written, so updating one never clears
// the other. Send "" to clear a field (e.g. opportunity:"" ungroups it).
export async function POST(req: Request) {
  let body: { contactId?: number; note?: string; opportunity?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const contactId = Number(body.contactId);
  if (!Number.isInteger(contactId) || contactId <= 0) {
    return NextResponse.json({ error: "Missing/invalid contactId." }, { status: 400 });
  }
  const fields: { note?: string | null; opportunity?: string | null } = {};
  if ("note" in body) fields.note = body.note?.trim() || null;
  if ("opportunity" in body) fields.opportunity = body.opportunity?.trim() || null;
  try {
    setContactFlag(contactId, fields);
    return NextResponse.json({ ok: true, contactId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Unflag: /api/flags?contactId=123
export async function DELETE(req: Request) {
  const contactId = Number(new URL(req.url).searchParams.get("contactId"));
  if (!Number.isInteger(contactId) || contactId <= 0) {
    return NextResponse.json({ error: "Missing/invalid contactId." }, { status: 400 });
  }
  try {
    clearContactFlag(contactId);
    return NextResponse.json({ ok: true, contactId });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
