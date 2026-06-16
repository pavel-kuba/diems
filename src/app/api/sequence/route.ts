import { NextResponse } from "next/server";
import {
  listFollowupTemplates,
  setFollowupTemplate,
  resetFollowupTemplate,
} from "@/lib/outreach";
import { MAX_STEP } from "@/lib/sequence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Editable follow-up email bodies (steps 1..MAX_STEP). The subject is always
// "Re: <original subject>" so follow-ups thread under the initial email.
export async function GET() {
  try {
    return NextResponse.json({ steps: listFollowupTemplates() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg, steps: [] }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  let body: { step?: number; bodyHtml?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const step = Number(body.step);
  const html = body.bodyHtml;
  if (!Number.isInteger(step) || step < 1 || step > MAX_STEP) {
    return NextResponse.json(
      { error: `step must be 1..${MAX_STEP}` },
      { status: 400 }
    );
  }
  if (typeof html !== "string" || !html.trim()) {
    return NextResponse.json({ error: "bodyHtml is empty." }, { status: 400 });
  }
  try {
    setFollowupTemplate(step, html);
    return NextResponse.json({ ok: true, step });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Reset a step back to the built-in default.
export async function DELETE(req: Request) {
  const step = Number(new URL(req.url).searchParams.get("step"));
  if (!Number.isInteger(step) || step < 1 || step > MAX_STEP) {
    return NextResponse.json(
      { error: `step must be 1..${MAX_STEP}` },
      { status: 400 }
    );
  }
  try {
    resetFollowupTemplate(step);
    return NextResponse.json({ ok: true, step });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
