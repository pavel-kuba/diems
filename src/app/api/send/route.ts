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
import { recordSend, advanceStep } from "@/lib/outreach";

export const runtime = "nodejs";

type Recipient = {
  email: string;
  name?: string;
  firstName?: string;
  company?: string;
  /** DB contact id — when present, the send is logged as step 0 (enrolls them). */
  contactId?: number;
};

type SendPayload = {
  from?: string; // "Name <email@domain>"
  replyTo?: string;
  subject?: string;
  bodyHtml?: string;
  preheader?: string;
  recipients?: Recipient[];
};

type SendResult = {
  email: string;
  ok: boolean;
  id?: string;
  error?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function resendKey(): string {
  return (process.env.RESEND_API_KEY || "").trim();
}

// Lets the UI show whether the env var is configured, without exposing the key.
export async function GET() {
  const key = resendKey();
  return NextResponse.json({ configured: !!key && key.startsWith("re_") });
}

export async function POST(req: Request) {
  let payload: SendPayload;
  try {
    payload = (await req.json()) as SendPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { from, replyTo, subject, bodyHtml, preheader, recipients } = payload;

  const key = resendKey();

  if (!key) {
    return NextResponse.json(
      {
        error:
          "Missing RESEND_API_KEY. Add it to .env.local and restart the dev server.",
      },
      { status: 500 }
    );
  }
  if (!key.startsWith("re_")) {
    return NextResponse.json(
      { error: 'RESEND_API_KEY looks wrong — Resend keys start with "re_".' },
      { status: 500 }
    );
  }
  if (!from?.trim()) {
    return NextResponse.json(
      { error: "Missing From address. Set it in Settings." },
      { status: 400 }
    );
  }
  if (!subject?.trim()) {
    return NextResponse.json({ error: "Subject is empty." }, { status: 400 });
  }
  if (!bodyHtml?.trim()) {
    return NextResponse.json({ error: "Email body is empty." }, { status: 400 });
  }
  if (!recipients?.length) {
    return NextResponse.json(
      { error: "No recipients selected." },
      { status: 400 }
    );
  }

  const resend = new Resend(key);

  // Message-ID host: explicit env wins, else the From domain (keeps DKIM aligned).
  const sendingDomain = (process.env.SENDING_DOMAIN || "").trim() || domainOf(from);

  const results: SendResult[] = [];

  // Send one email per recipient so each person only sees their own address.
  // Each email is personalised via merge tags ([First Name], [Company], [Name]).
  // Space sends 5s apart (gentler on deliverability than a fast burst).
  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const to = r.name ? `${r.name} <${r.email}>` : r.email;

    const vars = { firstName: r.firstName, company: r.company, name: r.name };
    const personalSubject = personalizeSubject(subject, vars);
    const personalBody = applyMergeTags(bodyHtml, vars);
    const html = buildEmailHtml(personalBody, { preheader });
    const text = htmlToText(personalBody);

    // Step 0 of the sequence. A stable Message-ID lets follow-ups thread under it.
    // Only DB contacts (with a contactId) are enrolled/logged; ad-hoc extras aren't.
    const messageId = buildMessageId(r.contactId ?? 0, 0, sendingDomain);

    const res = await sendOne({
      resend,
      from,
      replyTo,
      to,
      subject: personalSubject,
      html,
      text,
      thread: { messageId },
    });

    results.push(
      res.ok
        ? { email: r.email, ok: true, id: res.resendId }
        : { email: r.email, ok: false, error: res.error }
    );

    if (r.contactId) {
      try {
        recordSend({
          contactId: r.contactId,
          step: 0,
          messageId,
          resendId: res.resendId,
          subject: personalSubject,
          toEmail: r.email,
          status: res.ok ? "sent" : "failed",
          error: res.ok ? undefined : res.error,
        });
        if (res.ok) advanceStep(r.contactId, 0, messageId);
      } catch {
        // Tracking is best-effort; never fail the send because of a DB write.
      }
    }

    if (i < recipients.length - 1) await sleep(5_000);
  }

  const sent = results.filter((r) => r.ok).length;
  return NextResponse.json({ sent, total: results.length, results });
}
