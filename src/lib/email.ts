/**
 * Convert the rich-text editor's HTML into email-safe HTML.
 *
 * The two jobs here:
 *  1. Turn Tiptap <mark> highlights into <span> with an inline
 *     background-color — many email clients strip <mark>, but every
 *     client respects inline background-color on a <span>.
 *  2. Wrap the body in a minimal, well-tested responsive email shell
 *     with inline styles (email clients ignore <style> unreliably).
 *
 * Pure string transforms — safe to run in a Node API route (no DOM).
 */

const DEFAULT_HIGHLIGHT = "#fff2a8";

export type MergeVars = {
  firstName?: string;
  company?: string;
  name?: string;
};

/**
 * Replace merge tags in a string (subject or body HTML).
 * Supported (case-insensitive): [First Name], [Company], [Name].
 * Empty values fall back to natural defaults so an email never ships with a
 * literal "[First Name]" in it.
 */
export function applyMergeTags(s: string, v: MergeVars): string {
  const firstName = (v.firstName || "").trim() || "there";
  const company = (v.company || "").trim() || "your company";
  const name = (v.name || "").trim() || firstName;
  return s
    .replace(/\[first[\s_]?name\]/gi, firstName)
    .replace(/\[company\]/gi, company)
    .replace(/\[name\]/gi, name);
}

/**
 * Personalize a subject line. When the recipient has no first name (a general
 * inbox like info@), drop a leading "[First Name]<separator>" token so the
 * subject reads "Featuring Acme" instead of "there — featuring Acme", then
 * apply the remaining merge tags. With a real first name, behaves like
 * applyMergeTags.
 */
export function personalizeSubject(subject: string, v: MergeVars): string {
  const hasFirst = !!(v.firstName && v.firstName.trim());
  let s = subject;
  if (!hasFirst) {
    const stripped = s.replace(/^\s*\[first[\s_]?name\]\s*[-—–:,]*\s*/i, "");
    if (stripped !== s && stripped) {
      s = stripped.charAt(0).toUpperCase() + stripped.slice(1);
    }
  }
  return applyMergeTags(s, v);
}

/** Replace <mark ...> ... </mark> with an inline-styled <span>. */
export function highlightsToInlineSpans(html: string): string {
  return html
    .replace(/<mark\b([^>]*)>/gi, (_m, attrs: string) => {
      let color: string | null = null;

      const styleMatch = attrs.match(/background-color:\s*([^;"']+)/i);
      if (styleMatch) color = styleMatch[1].trim();

      if (!color) {
        const dataColor = attrs.match(/data-color=["']([^"']+)["']/i);
        if (dataColor) color = dataColor[1].trim();
      }

      color = color || DEFAULT_HIGHLIGHT;
      return `<span style="background-color:${color};padding:0.12em 0.18em;border-radius:3px;">`;
    })
    .replace(/<\/mark>/gi, "</span>");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type WrapOptions = {
  /** Optional preview/preheader text shown in inbox list. */
  preheader?: string;
};

/**
 * Wrap editor body HTML in a minimal, plain email document — styled to read
 * like a normal personal email (no card, no background, no centred newsletter
 * layout), just left-aligned text in a standard email font.
 */
export function buildEmailHtml(bodyHtml: string, opts: WrapOptions = {}): string {
  const body = highlightsToInlineSpans(bodyHtml);
  const preheader = opts.preheader
    ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(
        opts.preheader
      )}</div>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
  </head>
  <body style="margin:0;padding:0;background:#ffffff;">
    ${preheader}
    <div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;max-width:640px;">
      ${body}
    </div>
  </body>
</html>`;
}

/** Extract the bare email address from a "Name <addr@host>" or "addr@host" string. */
export function emailAddress(s: string): string {
  const m = s.match(/<([^>]+)>/);
  return (m ? m[1] : s).trim().toLowerCase();
}

/** Domain part of an email-ish string, for use as the Message-ID host. */
export function domainOf(emailOrFrom: string): string {
  const addr = emailAddress(emailOrFrom);
  const at = addr.lastIndexOf("@");
  return at === -1 ? addr : addr.slice(at + 1);
}

/**
 * Build a stable RFC Message-ID for one outbound email so follow-ups can thread
 * under it: `<diems.{contactId}.s{step}@{domain}>`. The domain should match the
 * sending domain (DKIM alignment); falls back to a safe literal if blank.
 */
export function buildMessageId(
  contactId: number,
  step: number,
  sendingDomain: string
): string {
  // Be tolerant of a full email (e.g. SENDING_DOMAIN=pavel@angelcam.com) or a
  // URL — extract the bare domain, never splice the local part into the host.
  let raw = (sendingDomain || "").trim().replace(/^https?:\/\//, "");
  const at = raw.lastIndexOf("@");
  if (at !== -1) raw = raw.slice(at + 1);
  const host =
    raw.replace(/[^a-zA-Z0-9.\-]/g, "").replace(/^\.+|\.+$/g, "") ||
    "diems.local";
  return `<diems.${contactId}.s${step}@${host}>`;
}

/** Strip tags to produce a plain-text fallback. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
