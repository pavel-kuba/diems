/**
 * Verify a single email address before saving it, using a pluggable provider.
 * Normalizes every provider to: { email, status, score, source }.
 *   status ∈ valid | risky | invalid | unknown
 *
 * Provider chosen by VERIFIER_PROVIDER in .env.local:
 *   hunter      (default) → reuses HUNTER_API_KEY
 *   neverbounce          → VERIFIER_API_KEY
 *   zerobounce           → VERIFIER_API_KEY
 *
 * Usage: node scripts/verify-email.mjs jane@example.com
 */
import "./_env.mjs";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/verify-email.mjs <email>");
  process.exit(1);
}

const provider = (process.env.VERIFIER_PROVIDER || "hunter").toLowerCase();

// Map each provider's verdict onto our 4 buckets.
const BUCKET = {
  hunter: { deliverable: "valid", risky: "risky", undeliverable: "invalid", unknown: "unknown" },
  neverbounce: { valid: "valid", catchall: "risky", unknown: "unknown", disposable: "risky", invalid: "invalid" },
  zerobounce: { valid: "valid", "catch-all": "risky", unknown: "unknown", spamtrap: "risky", abuse: "risky", do_not_mail: "invalid", invalid: "invalid" },
};

async function run() {
  if (provider === "hunter") {
    const key = process.env.HUNTER_API_KEY;
    if (!key) throw new Error("HUNTER_API_KEY not set");
    const u = new URL("https://api.hunter.io/v2/email-verifier");
    u.searchParams.set("email", email);
    u.searchParams.set("api_key", key);
    const d = (await (await fetch(u)).json()).data;
    return { email, status: BUCKET.hunter[d.status] || "unknown", score: d.score, source: "hunter" };
  }
  if (provider === "neverbounce") {
    const key = process.env.VERIFIER_API_KEY;
    if (!key) throw new Error("VERIFIER_API_KEY not set");
    const u = new URL("https://api.neverbounce.com/v4/single/check");
    u.searchParams.set("key", key);
    u.searchParams.set("email", email);
    const d = await (await fetch(u)).json();
    return { email, status: BUCKET.neverbounce[d.result] || "unknown", score: null, source: "neverbounce" };
  }
  if (provider === "zerobounce") {
    const key = process.env.VERIFIER_API_KEY;
    if (!key) throw new Error("VERIFIER_API_KEY not set");
    const u = new URL("https://api.zerobounce.net/v2/validate");
    u.searchParams.set("api_key", key);
    u.searchParams.set("email", email);
    const d = await (await fetch(u)).json();
    return { email, status: BUCKET.zerobounce[d.status] || "unknown", score: null, source: "zerobounce" };
  }
  throw new Error(`Unknown VERIFIER_PROVIDER "${provider}"`);
}

run()
  .then((r) => console.log(JSON.stringify(r, null, 2)))
  .catch((e) => {
    console.error("✗ " + e.message);
    process.exit(1);
  });
