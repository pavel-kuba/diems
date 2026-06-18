/**
 * Merge duplicate company rows that are the SAME real company imported twice
 * (same domain + same core brand). Folds all contacts into one canonical row,
 * backfills any fields the canonical row is missing, keeps a single is_primary,
 * and deletes the redundant company row(s). Contacts keep their ids (so
 * outreach / outreach_sends / contact_flags are untouched) — only company_id +
 * company_slug change. No outreach trimming: every contact stays as-is.
 *
 *   node scripts/merge-duplicate-companies.mjs            # dry run (default)
 *   node scripts/merge-duplicate-companies.mjs --apply    # write (backs up first)
 *
 * The GROUPS list is hand-classified to CLEAR duplicates only. Same-domain but
 * DISTINCT brands/subsidiaries (Paladin Security Group vs Paladin Technologies,
 * G4S vs G4S India, the Sentry/Holmes/NYPD cluster, etc.) are deliberately left
 * out. Re-running is safe: ids already merged away are skipped.
 */
import Database from "better-sqlite3";
import { DB_PATH } from "./_env.mjs";

const APPLY = process.argv.includes("--apply");

// Each inner array = company ids that are the SAME company (first comment = domain).
const GROUPS = [
  [458, 459, 472], // cmsn.com — CMS / Criticom Monitoring Services
  [363, 364],      // adt.com — ADT
  [478, 479],      // danners.com — Danner's
  [483, 484],      // depssecuritygroup.com — DEPS
  [504, 505],      // electronixsystems.com — Electronix Systems
  [554, 555],      // guardianhawk.com — Guardian Hawk Security
  [556, 557],      // guardianprotection.com — Guardian Protection
  [578, 579],      // interfacesystems.com — Interface Security Systems
  [582, 583],      // ion247.com — Ion247
  [588, 589],      // jadealarm.com — Jade Alarm
  [619, 724],      // mobilevideoguard.com — Mobile Video Guard
  [375, 376],      // monitor1.com — Alarm Monitoring Services
  [626, 627],      // nationwidedigital.com — Nationwide Digital/Central Station Monitoring
  [639, 640],      // olliviercorp.com — Ollivier
  [642, 643],      // onviewsolutions.com — OnView Integrated Solutions
  [666, 667],      // quickresponse.net — Quick Response
  [326, 327],      // smon.co.uk — Southern Monitoring Services
  [745, 746],      // statewidecs.com — Statewide Central Station
  [780, 782],      // teamucc.com — UCC / United Central Control
  [766, 767],      // tpcsecurity.com — Titan Protection and Consulting
  [170, 171],      // trss.co.za — TRSS Reaction
  [786, 787],      // usacentralstation.com — USA Central Station
  [637, 789],      // vectorsecurity.com — Vector Security
  [807, 809],      // whirc.com — WH International Response Center
];

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const normHost = (w) =>
  (w || "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");

const getCompany = db.prepare("SELECT * FROM companies WHERE id = ?");
const contactsOf = db.prepare(
  "SELECT id, name, email_status, is_primary FROM contacts WHERE company_id = ?"
);
const STATUS_RANK = { valid: 0, risky: 1, unknown: 2, invalid: 3 };
// Fields to backfill onto the canonical row if it's missing them. (description
// is handled separately — we always take the longest one in the group.)
const FILL = [
  "website", "city", "region", "country",
  "revenue_text", "revenue_usd", "employees", "revenue_source",
];
const empty = (v) => v === null || v === undefined || String(v).trim() === "";

// Lower = better. Penalise scraped-banner / legal-suffix artefacts so the
// surviving row carries a clean name (it feeds the [Company] merge tag).
const nameScore = (name) => {
  const n = name || "";
  let s = 0;
  if (n.includes("|")) s += 100;            // "Ollivier Managed Security | Smart Site"
  if (/\bdba\b/i.test(n)) s += 100;          // "... dba Mobile Video Guard"
  if (/^\s*now part of/i.test(n)) s += 100;  // "Now part of Vector Security"
  if (n.includes("(")) s += 50;              // "... (trading as ...)"
  if (/\b(limited|llc|inc\.?|corp\.?|incorporated)\b/i.test(n)) s += 20;
  return s;
};

const nowIso = () => new Date().toISOString();

function planGroup(ids) {
  const rows = ids.map((id) => getCompany.get(id)).filter(Boolean);
  if (rows.length < 2) return { skip: `only ${rows.length} of ${ids.length} ids still exist` };

  const hosts = new Set(rows.map((r) => normHost(r.website)));
  if (hosts.size !== 1) return { skip: `hosts differ (${[...hosts].join(", ")}) — refusing` };

  for (const r of rows) r._contacts = contactsOf.all(r.id).length;
  // canonical = cleanest name, then more-complete name, then most contacts, lowest id
  const canonical = [...rows].sort((a, b) => {
    const ns = nameScore(a.name) - nameScore(b.name);
    if (ns) return ns;
    const nl = (b.name || "").length - (a.name || "").length;
    if (nl) return nl;
    if (b._contacts !== a._contacts) return b._contacts - a._contacts;
    return a.id - b.id;
  })[0];
  const others = rows.filter((r) => r.id !== canonical.id);
  // Richest description in the group, regardless of which row it came from.
  const bestDesc = rows.map((r) => r.description || "").sort((a, b) => b.length - a.length)[0];
  return { canonical, others, bestDesc };
}

let mergedGroups = 0, movedContacts = 0, deletedRows = 0;

const run = db.transaction(() => {
  for (const ids of GROUPS) {
    const p = planGroup(ids);
    if (p.skip) { console.log(`• [${ids.join(",")}] SKIP — ${p.skip}`); continue; }
    const { canonical, others, bestDesc } = p;
    const otherIds = others.map((o) => o.id);

    console.log(
      `• KEEP #${canonical.id} "${canonical.name}" (${canonical.slug})  ⟵  merge ` +
        others.map((o) => `#${o.id} "${o.name}"`).join(", ")
    );

    // Backfill missing canonical fields from the others (first non-empty wins),
    // and always carry the richest description in the group.
    const fill = {};
    for (const f of FILL) {
      if (empty(canonical[f])) {
        const donor = others.find((o) => !empty(o[f]));
        if (donor) fill[f] = donor[f];
      }
    }
    if (bestDesc.length > (canonical.description || "").length) fill.description = bestDesc;
    if (Object.keys(fill).length) {
      console.log(`    backfill: ${Object.keys(fill).join(", ")}`);
      if (APPLY) {
        const set = Object.keys(fill).map((f) => `${f} = @${f}`).join(", ");
        db.prepare(`UPDATE companies SET ${set} WHERE id = @id`).run({ ...fill, id: canonical.id });
      }
    }

    // Move contacts from the other rows into the canonical company.
    for (const o of others) {
      const cs = contactsOf.all(o.id);
      movedContacts += cs.length;
      if (APPLY && cs.length) {
        db.prepare(
          `UPDATE contacts
             SET company_id = @cid, company_slug = @slug, updated_at = @now,
                 notes = COALESCE(notes,'') || @note
           WHERE company_id = @old`
        ).run({
          cid: canonical.id, slug: canonical.slug, now: nowIso(), old: o.id,
          note: ` | ${nowIso().slice(0, 10)}: Listing merged into "${canonical.name}" (duplicate company row #${o.id} "${o.name}" removed).`,
        });
      }
    }
    console.log(`    moved ${others.reduce((n, o) => n + contactsOf.all(o.id).length, 0)} contact(s)`);

    // Keep exactly one is_primary among the merged company's contacts.
    if (APPLY) {
      const prims = db
        .prepare("SELECT id, email_status FROM contacts WHERE company_id = ? AND is_primary = 1")
        .all(canonical.id);
      if (prims.length > 1) {
        prims.sort(
          (a, b) =>
            (STATUS_RANK[a.email_status] ?? 9) - (STATUS_RANK[b.email_status] ?? 9) || a.id - b.id
        );
        const keep = prims[0].id;
        db.prepare("UPDATE contacts SET is_primary = 0 WHERE company_id = ? AND id <> ?").run(canonical.id, keep);
        console.log(`    primary kept: contact #${keep} (others un-starred)`);
      }
      // Delete the now-empty duplicate rows.
      for (const id of otherIds) db.prepare("DELETE FROM companies WHERE id = ?").run(id);
    }
    deletedRows += otherIds.length;
    mergedGroups++;
  }
});

(async () => {
  if (APPLY) {
    const bak = DB_PATH + ".bak-merge-" + nowIso().replace(/[:.]/g, "-");
    await db.backup(bak);
    console.log(`Backup: ${bak}\n`);
  } else {
    console.log("DRY RUN (no changes) — pass --apply to write\n");
  }
  run();
  console.log(
    `\n${APPLY ? "MERGED" : "Would merge"}: ${mergedGroups} group(s), ` +
      `${movedContacts} contact(s) moved, ${deletedRows} company row(s) ${APPLY ? "deleted" : "to delete"}.`
  );
  db.close();
})();
