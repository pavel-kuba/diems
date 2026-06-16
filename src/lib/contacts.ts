// Shared types + email-status helpers for the researched SQLite contacts
// (served by /api/contacts). Used by both the Compose and Contacts tabs.

export type DBContact = {
  id: number;
  name: string;
  first_name: string | null;
  title: string | null;
  company: string | null;
  company_slug: string | null;
  market: string | null; // company market/country slug (e.g. "ca", "internal")
  email: string | null;
  email_type: string | null;
  email_status: string | null;
  email_confidence: number | null;
  linkedin: string | null;
  is_primary: number | null;
};

type StatusMeta = {
  label: string;
  cls: string; // tailwind classes for the badge
  sendable: boolean; // safe/possible to email
  caution: boolean; // deliverability uncertain — warn before sending
};

// email_status → display + behaviour. `null`/empty and "invalid" are not deliverable.
export const STATUS_META: Record<string, StatusMeta> = {
  valid: { label: "valid", cls: "bg-emerald-100 text-emerald-800", sendable: true, caution: false },
  risky: { label: "risky", cls: "bg-amber-100 text-amber-800", sendable: true, caution: true },
  unknown: { label: "unknown", cls: "bg-amber-100 text-amber-800", sendable: true, caution: true },
  invalid: { label: "invalid", cls: "bg-red-100 text-red-700", sendable: false, caution: true },
};

export function statusOf(s: string | null): StatusMeta {
  return (
    (s && STATUS_META[s]) || {
      label: s || "—",
      cls: "bg-stone-200/70 text-stone-500",
      sendable: false,
      caution: false,
    }
  );
}

// Sendable only if it has an email AND the status isn't a hard fail.
export const isSendable = (c: DBContact) => !!c.email && statusOf(c.email_status).sendable;

/**
 * The first name to greet a contact by, or undefined for a general inbox.
 * Uses the real first_name when set; otherwise derives one from the contact
 * name ONLY for personal contacts — never for company inboxes (info@), where
 * the "name" is the company itself (e.g. "Acme (general inbox)").
 */
export function firstNameOf(c: DBContact): string | undefined {
  const fn = (c.first_name || "").trim();
  if (fn) return fn;
  if (c.email_type === "personal" && c.name) {
    return c.name.trim().split(/\s+/)[0] || undefined;
  }
  return undefined;
}
