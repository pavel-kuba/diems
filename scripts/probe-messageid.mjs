/**
 * De-risk probe for the follow-up threading feature.
 *
 * Threading assumes Resend sends a caller-supplied `Message-ID` header VERBATIM
 * (so follow-ups can reference it via In-Reply-To). This sends one email with a
 * known Message-ID; open it in Gmail → "Show original" and confirm the
 * `Message-ID:` line matches exactly. If it doesn't, Resend overrode it and the
 * threading scheme needs the fallback (capture the delivered id instead).
 *
 *   node scripts/probe-messageid.mjs <to-address> [from-address]
 *
 * `from` defaults to onboarding@resend.dev (works without a verified domain).
 */
import "./_env.mjs";
import { Resend } from "resend";

const to = process.argv[2];
const from = process.argv[3] || "Diems Probe <onboarding@resend.dev>";

if (!to) {
  console.error("Usage: node scripts/probe-messageid.mjs <to-address> [from-address]");
  process.exit(1);
}

const key = (process.env.RESEND_API_KEY || "").trim();
if (!key.startsWith("re_")) {
  console.error("Missing/invalid RESEND_API_KEY in .env.local (must start with re_).");
  process.exit(1);
}

const domain = from.match(/@([^>\s]+)/)?.[1] || "diems.local";
const messageId = `<diems.probe.s0@${domain}>`;

const resend = new Resend(key);
const { data, error } = await resend.emails.send({
  from,
  to,
  subject: "diems Message-ID probe",
  html: "<p>If threading works, the Message-ID below is honored verbatim.</p>" +
    `<p><code>${messageId}</code></p>`,
  text: `Expected Message-ID: ${messageId}`,
  headers: { "Message-ID": messageId },
});

if (error) {
  console.error("Send failed:", error.message);
  process.exit(1);
}

console.log("Sent. Resend id:", data?.id);
console.log("Expected Message-ID:", messageId);
console.log(
  "\nOpen the received email and view its raw headers:\n" +
    "  • Gmail / Google Workspace → ⋮ → 'Show original'\n" +
    "  • Outlook                  → ⋯ → 'View' → 'View message source'\n" +
    "Check the `Message-ID:` header equals the value above.\n" +
    "  • Matches → threading will work as planned.\n" +
    "  • Differs → Resend overrode it; tell me and I'll switch sender.ts to\n" +
    "              capture the delivered Message-ID instead."
);
