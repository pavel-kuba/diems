/**
 * List companies and how many contacts each already has — the work queue for
 * the research-contacts skill.
 *
 * Usage:
 *   node scripts/list-targets.mjs                 # all companies, JSON
 *   node scripts/list-targets.mjs --needs         # only companies with 0 contacts
 *   node scripts/list-targets.mjs --needs --limit 10
 *   node scripts/list-targets.mjs --slug api-alarm-inc   # one company + its contacts
 */
import Database from "better-sqlite3";
import { DB_PATH } from "./_env.mjs";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => {
  const i = args.indexOf(f);
  return i !== -1 ? args[i + 1] : null;
};

const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

const slug = val("--slug");
if (slug) {
  const company = db
    .prepare("SELECT id, slug, name, website, city, region, country FROM companies WHERE slug = ?")
    .get(slug);
  const contacts = db
    .prepare("SELECT name, title, email, email_type, email_status, email_confidence, linkedin FROM contacts WHERE company_slug = ?")
    .all(slug);
  console.log(JSON.stringify({ company, contacts }, null, 2));
  db.close();
  process.exit(0);
}

let rows = db
  .prepare(
    `SELECT c.slug, c.name, c.website, c.city, c.region, c.country,
            COALESCE(c.revenue_text,'') AS revenue, c.employees,
            (SELECT COUNT(*) FROM contacts ct WHERE ct.company_slug = c.slug) AS contact_count
     FROM companies c
     ORDER BY c.position, c.name`
  )
  .all();

if (has("--needs")) rows = rows.filter((r) => r.contact_count === 0);
const limit = val("--limit");
if (limit) rows = rows.slice(0, Number(limit));

console.log(JSON.stringify(rows, null, 2));
console.error(
  `\n${rows.length} company(ies)` + (has("--needs") ? " with no contacts yet." : ".")
);
db.close();
