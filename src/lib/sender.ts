/**
 * Shared low-level Resend send used by both the initial send (/api/send) and
 * the follow-up engine (/api/followups/send). It always sets our own RFC
 * Message-ID and, for follow-ups, the In-Reply-To/References headers that make
 * the email nest under the original thread.
 *
 * ⚠️ Threading relies on Resend honouring the caller-supplied Message-ID header
 * verbatim — verify with scripts/probe-messageid.mjs before trusting it.
 */
import type { Resend } from "resend";

export type ThreadHeaders = {
  /** Our RFC Message-ID for this email, e.g. <diems.42.s0@mail.example.com>. */
  messageId: string;
  /** The thread anchor (the step-0 Message-ID) — set on follow-ups only. */
  inReplyTo?: string;
  references?: string;
};

export type SendOneResult = { ok: boolean; resendId?: string; error?: string };

export async function sendOne(args: {
  resend: Resend;
  from: string;
  replyTo?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  thread: ThreadHeaders;
}): Promise<SendOneResult> {
  const headers: Record<string, string> = {
    "Message-ID": args.thread.messageId,
  };
  if (args.thread.inReplyTo) headers["In-Reply-To"] = args.thread.inReplyTo;
  if (args.thread.references) headers["References"] = args.thread.references;

  try {
    const { data, error } = await args.resend.emails.send({
      from: args.from,
      to: args.to,
      subject: args.subject,
      html: args.html,
      text: args.text,
      ...(args.replyTo ? { replyTo: args.replyTo } : {}),
      headers,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, resendId: data?.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Unknown error" };
  }
}
