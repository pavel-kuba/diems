/**
 * Import monitoring-station companies from monitoringstationguide.com into SQLite.
 *
 * Usage:
 *   node scripts/import-companies.mjs [market]      # default market: ca
 *
 * Data sources (both are clean JSON-LD embedded in the pages):
 *   - /market/<m>            → ItemList of companies (name + detail URL)
 *   - /company/<slug>        → LocalBusiness (website, city, province, country)
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const MARKET = (process.argv[2] || "ca").toLowerCase();
const BASE = "https://www.monitoringstationguide.com";
const UA = { headers: { "User-Agent": "Mozilla/5.0 (diems importer)" } };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getText(url) {
  const res = await fetch(url, UA);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

/** Extract every {"@type":"<type>", ...} JSON object from page HTML. */
function extractJsonLdObjects(html, type) {
  const objs = [];
  const marker = `"@type":"${type}"`;
  let from = 0;
  for (;;) {
    const at = html.indexOf(marker, from);
    if (at === -1) break;
    const start = html.lastIndexOf("{", at);
    let depth = 0;
    let end = -1;
    for (let i = start; i < html.length; i++) {
      const c = html[i];
      if (c === "{") depth++;
      else if (c === "}") {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    try {
      objs.push(JSON.parse(html.slice(start, end + 1)));
    } catch {
      /* skip malformed slice */
    }
    from = end + 1;
  }
  return objs;
}

function slugFromUrl(url) {
  return url.replace(/\/+$/, "").split("/").pop();
}

async function main() {
  console.log(`Fetching market list: ${BASE}/market/${MARKET}`);
  const listHtml = await getText(`${BASE}/market/${MARKET}`);
  const items = extractJsonLdObjects(listHtml, "ListItem")
    .filter((o) => o.url && o.url.includes("/company/"))
    .map((o) => ({
      position: o.position ?? null,
      name: o.name,
      detailUrl: o.url,
      slug: slugFromUrl(o.url),
    }));

  // De-dupe by slug (listing can repeat).
  const bySlug = new Map();
  for (const it of items) if (!bySlug.has(it.slug)) bySlug.set(it.slug, it);
  const companies = [...bySlug.values()];
  console.log(`Found ${companies.length} companies. Fetching detail pages…`);

  // --- DB setup ---
  mkdirSync(join(ROOT, "data"), { recursive: true });
  const db = new Database(join(ROOT, "data", "monitoring.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      slug        TEXT UNIQUE NOT NULL,
      name        TEXT NOT NULL,
      website     TEXT,
      city        TEXT,
      region      TEXT,
      country     TEXT,
      description  TEXT,
      market      TEXT NOT NULL,
      detail_url  TEXT,
      position    INTEGER,
      fetched_at  TEXT NOT NULL
    );
  `);

  const upsert = db.prepare(`
    INSERT INTO companies
      (slug, name, website, city, region, country, description, market, detail_url, position, fetched_at)
    VALUES
      (@slug, @name, @website, @city, @region, @country, @description, @market, @detail_url, @position, @fetched_at)
    ON CONFLICT(slug) DO UPDATE SET
      name=excluded.name, website=excluded.website, city=excluded.city,
      region=excluded.region, country=excluded.country, description=excluded.description,
      market=excluded.market, detail_url=excluded.detail_url,
      position=excluded.position, fetched_at=excluded.fetched_at;
  `);

  const now = new Date().toISOString();
  let ok = 0;
  let enriched = 0;

  for (let i = 0; i < companies.length; i++) {
    const c = companies[i];
    let website = null;
    let city = null;
    let region = null;
    let country = null;
    let description = null;

    try {
      const html = await getText(c.detailUrl);
      const biz = extractJsonLdObjects(html, "LocalBusiness")[0];
      if (biz) {
        website = biz.url || null;
        description = biz.description || null;
        const a = biz.address || {};
        city = a.addressLocality || null;
        region = a.addressRegion || null;
        country = a.addressCountry || null;
        if (website || city) enriched++;
      }
    } catch (e) {
      console.warn(`  ! detail failed for ${c.slug}: ${e.message}`);
    }

    upsert.run({
      slug: c.slug,
      name: c.name,
      website,
      city,
      region,
      country,
      description,
      market: MARKET,
      detail_url: c.detailUrl,
      position: c.position,
      fetched_at: now,
    });
    ok++;
    process.stdout.write(`\r  stored ${ok}/${companies.length}`);
    await sleep(120);
  }

  const total = db.prepare("SELECT COUNT(*) n FROM companies").get().n;
  console.log(
    `\nDone. Upserted ${ok} (${enriched} enriched with website/city). DB now holds ${total} companies.`
  );
  console.log(`SQLite file: ${join(ROOT, "data", "monitoring.db")}`);
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
