import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  applyMergeTags,
  buildEmailHtml,
  buildMessageId,
  domainOf,
  htmlToText,
  personalizeSubject,
} from "@/lib/email";
import { sendOne } from "@/lib/sender";
import { followupSubject, MAX_STEP } from "@/lib/sequence";
import { getFollowupBody } from "@/lib/outreach";

export const runtime = "nodejs";

/**
 * Test-send ONE follow-up step to a throwaway address so the operator can see
 * exactly how it renders in a real inbox before any live follow-ups go out.
 *
 * This is a pure preview: it does NOT log to outreach_sends, does NOT advance
 * any contact's step, and never touches a real contact's outreach state. It
 * sends a single standalone email (no thread headers) with sample merge values,
 * a "[TEST] Re: …" subject, through the same render + send path as the real
 * follow-up engine.
 */

type Payload = {
  step?: number;
  bodyHtml?: string; // current editor content (may be unsaved); falls back to the live template
  from?: string; // "Name <email@domain>"
  replyTo?: string;
  to?: string; // test recipient; defaults to pavel.kuba@angelcam.com
  baseSubject?: string; // the step-0 subject this would thread under
};

// Same sample values the Sequence editor's live preview uses, so the test
// email matches what's shown on screen.
const SAMPLE = { firstName: "Jane", company: "Acme Monitoring", name: "Jane Doe" };
const DEFAULT_TO = "pavel.kuba@angelcam.com";
const DEFAULT_BASE_SUBJECT = "[First Name] — featuring [Company]";

export async function POST(req: Request) {
  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { step, bodyHtml, from, replyTo, to, baseSubject } = payload;

  const key = (process.env.RESEND_API_KEY || "").trim();
  if (!key || !key.startsWith("re_")) {
    return NextResponse.json(
      { error: "Missing/invalid RESEND_API_KEY. Set it in .env.local and restart." },
      { status: 500 }
    );
  }
  if (!Number.isInteger(step) || (step as number) < 1 || (step as number) > MAX_STEP) {
    return NextResponse.json({ error: `step must be 1..${MAX_STEP}` }, { status: 400 });
  }
  if (!from?.trim()) {
    return NextResponse.json(
      { error: "Missing From address. Set it in Settings." },
      { status: 400 }
    );
  }

  const toEmail = (to || DEFAULT_TO).trim();

  // Use the on-screen body if provided (lets you test unsaved edits), else the
  // live saved/default template for this step.
  const rawBody = (bodyHtml && bodyHtml.trim()) || getFollowupBody(step as number);
  const body = applyMergeTags(rawBody, SAMPLE);
  const html = buildEmailHtml(body);
  const text = htmlToText(body);

  // Mirror the real follow-up subject: "Re: <personalized step-0 subject>",
  // then mark it clearly as a test so it can't be confused with a live send.
  const personalBase = personalizeSubject(baseSubject || DEFAULT_BASE_SUBJECT, SAMPLE);
  const subject = `[TEST] ${followupSubject(personalBase)}`;

  const sendingDomain = (process.env.SENDING_DOMAIN || "").trim() || domainOf(from);
  // Standalone Message-ID (no In-Reply-To/References) — a test isn't threaded
  // under a real conversation. Contact id 0 keeps it clear of real ids.
  const messageId = buildMessageId(0, step as number, sendingDomain);

  const resend = new Resend(key);
  const res = await sendOne({
    resend,
    from,
    replyTo,
    to: toEmail,
    subject,
    html,
    text,
    thread: { messageId },
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 502 });
  }
  return NextResponse.json({ ok: true, id: res.resendId, to: toEmail, step });
}
