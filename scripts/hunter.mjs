/**
 * Hunter.io CLI wrapper — find + verify decision-maker emails at a domain.
 * Requires HUNTER_API_KEY in .env.local.
 *
 * Usage:
 *   node scripts/hunter.mjs domain example.com [--dept executive --seniority senior]
 *       → people + emails at the domain (filtered, with confidence + linkedin)
 *   node scripts/hunter.mjs find example.com Jane Example
 *       → most likely email for a named person (+ confidence)
 *   node scripts/hunter.mjs verify jane@example.com
 *       → deliverability: status (deliverable|risky|undeliverable|unknown) + score
 *
 * All output is JSON on stdout. Hunter rate limit is ~15 req/s; be gentle.
 */
import { setTimeout as sleep } from "node:timers/promises";
import "./_env.mjs";

const KEY = process.env.HUNTER_API_KEY;
if (!KEY) {
  console.error("✗ HUNTER_API_KEY is not set. Add it to .env.local (see .env.example).");
  process.exit(1);
}

const API = "https://api.hunter.io/v2";

async function get(path, params) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(params)) if (v != null) url.searchParams.set(k, v);
  url.searchParams.set("api_key", KEY);
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url);
    if (res.status === 429) {
      await sleep(1500 * (attempt + 1));
      continue;
    }
    const json = await res.json();
    if (!res.ok) {
      const msg = json?.errors?.[0]?.details || res.statusText;
      throw new Error(`Hunter ${res.status}: ${msg}`);
    }
    return json.data;
  }
  throw new Error("Hunter: rate-limited after retries");
}

const [cmd, ...rest] = process.argv.slice(2);
const flag = (f) => {
  const i = rest.indexOf(f);
  return i !== -1 ? rest[i + 1] : null;
};

try {
  if (cmd === "domain") {
    const domain = rest[0];
    const data = await get("/domain-search", {
      domain,
      limit: flag("--limit") || 10, // Hunter caps this per plan (free = 10)
      department: flag("--dept"), // executive, it, sales, support, etc.
      seniority: flag("--seniority"), // junior, senior, executive
    });
    const people = (data.emails || []).map((e) => ({
      first_name: e.first_name,
      last_name: e.last_name,
      email: e.value,
      type: e.type, // personal | generic
      confidence: e.confidence,
      position: e.position,
      seniority: e.seniority,
      department: e.department,
      linkedin: e.linkedin,
      phone: e.phone_number,
      verification: e.verification?.status, // may be null until verified
      sources: (e.sources || []).length,
    }));
    console.log(
      JSON.stringify(
        { domain: data.domain, organization: data.organization, pattern: data.pattern, count: people.length, people },
        null,
        2
      )
    );
  } else if (cmd === "find") {
    const [domain, first, ...lastParts] = rest;
    const data = await get("/email-finder", {
      domain,
      first_name: first,
      last_name: lastParts.join(" "),
    });
    console.log(
      JSON.stringify(
        {
          email: data.email,
          score: data.score,
          status: data.verification?.status,
          position: data.position,
          linkedin: data.linkedin_url,
          sources: (data.sources || []).length,
        },
        null,
        2
      )
    );
  } else if (cmd === "verify") {
    const data = await get("/email-verifier", { email: rest[0] });
    console.log(
      JSON.stringify(
        {
          email: data.email,
          status: data.status, // deliverable | risky | undeliverable | unknown
          result: data.result,
          score: data.score,
          mx_records: data.mx_records,
          smtp_check: data.smtp_check,
          accept_all: data.accept_all,
          disposable: data.disposable,
        },
        null,
        2
      )
    );
  } else {
    console.error("Unknown command. Use: domain | find | verify (see file header).");
    process.exit(1);
  }
} catch (err) {
  console.error("✗ " + err.message);
  process.exit(1);
}
