import { NextResponse } from "next/server";
import { Resend } from "resend";
import {
  applyMergeTags,
  buildEmailHtml,
  buildMessageId,
  domainOf,
  htmlToText,
} from "@/lib/email";
import { sendOne } from "@/lib/sender";
import { followupSubject } from "@/lib/sequence";
import {
  getDueContacts,
  recordSend,
  advanceStep,
  getFollowupBody,
} from "@/lib/outreach";

export const runtime = "nodejs";

type Payload = {
  from?: string; // "Name <email@domain>"
  replyTo?: string;
  preheader?: string;
  contactIds?: number[]; // omit/empty = send to everyone currently due
};

type SendResult = { email: string; ok: boolean; step?: number; error?: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST(req: Request) {
  let payload: Payload;
  try {
    payload = (await req.json()) as Payload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { from, replyTo, preheader, contactIds } = payload;

  const key = (process.env.RESEND_API_KEY || "").trim();
  if (!key || !key.startsWith("re_")) {
    return NextResponse.json(
      { error: "Missing/invalid RESEND_API_KEY. Set it in .env.local and restart." },
      { status: 500 }
    );
  }
  if (!from?.trim()) {
    return NextResponse.json(
      { error: "Missing From address. Set it in Settings." },
      { status: 400 }
    );
  }

  // Recompute due here (don't trust a client list of who's due) and optionally
  // narrow to an explicit selection. A reply landing between list and send is
  // naturally excluded because getDueContacts only returns `active` contacts.
  const allDue = getDueContacts(new Date());
  const wanted = contactIds?.length ? new Set(contactIds) : null;
  const due = wanted ? allDue.filter((d) => wanted.has(d.contact_id)) : allDue;

  if (due.length === 0) {
    return NextResponse.json({ sent: 0, total: 0, results: [] });
  }

  const resend = new Resend(key);
  const sendingDomain = (process.env.SENDING_DOMAIN || "").trim() || domainOf(from);
  const results: SendResult[] = [];

  for (let i = 0; i < due.length; i++) {
    const d = due[i];
    const step = d.next_step;
    const to = d.name ? `${d.name} <${d.email}>` : d.email;

    const vars = {
      firstName: d.first_name || undefined,
      company: d.company || undefined,
      name: d.name || undefined,
    };
    const subject = followupSubject(d.step0_subject || "");
    const body = applyMergeTags(getFollowupBody(step), vars);
    const html = buildEmailHtml(body, { preheader });
    const text = htmlToText(body);

    // Thread under the original. Build the RFC References chain from all prior
    // steps (ids are deterministic), set In-Reply-To to the immediately
    // previous message, and References to the whole chain incl. the original.
    const messageId = buildMessageId(d.contact_id, step, sendingDomain);
    const refIds: string[] = [];
    for (let k = 0; k < step; k++) refIds.push(buildMessageId(d.contact_id, k, sendingDomain));
    // The stored step-0 id wins for index 0 (guards against a domain change).
    if (d.thread_message_id && refIds.length) refIds[0] = d.thread_message_id;
    const inReplyTo = refIds[refIds.length - 1];
    const references = refIds.join(" ");

    const res = await sendOne({
      resend,
      from,
      replyTo,
      to,
      subject,
      html,
      text,
      thread: { messageId, inReplyTo, references },
    });

    try {
      recordSend({
        contactId: d.contact_id,
        step,
        messageId,
        resendId: res.resendId,
        subject,
        toEmail: d.email,
        status: res.ok ? "sent" : "failed",
        error: res.ok ? undefined : res.error,
      });
      // Only advance the pointer on success, so a failed step is retried next run.
      if (res.ok) advanceStep(d.contact_id, step);
    } catch {
      /* tracking is best-effort */
    }

    results.push(
      res.ok
        ? { email: d.email, ok: true, step }
        : { email: d.email, ok: false, step, error: res.error }
    );

    if (i < due.length - 1) await sleep(5_000);
  }

  const sent = results.filter((r) => r.ok).length;
  return NextResponse.json({ sent, total: results.length, results });
}
