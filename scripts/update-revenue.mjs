/**
 * Write researched annual-revenue + employee estimates into companies table.
 *
 * Figures are mostly THIRD-PARTY ESTIMATES from Exa's company dataset
 * (Apollo/ZoomInfo-style firmographics), except public companies whose
 * revenue is from filings. revenue_usd is null when only a range or no
 * figure was available; revenue_text holds the human-readable value.
 *
 * Usage: node scripts/update-revenue.mjs
 */

import Database from "better-sqlite3";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const db = new Database(join(__dirname, "..", "data", "monitoring.db"), {
  fileMustExist: true,
});

// slug: [revenue_usd | null, revenue_text | null, employees | null]
const DATA = {
  "247-alert-monitoring": [null, "Undisclosed (startup, est. 2024)", 1],
  "api-alarm-inc": [19588272, "$19.6M", 38],
  "api-alarm-ontario": [19588272, "$19.6M", 38],
  "ac-technical-systems-ontario": [38699406, "$38.7M", 23],
  "accurate-security-british-columbia": [15419232, "$15.4M", 6],
  "active-watch-security-british-columbia": [null, "Undisclosed", 16],
  "ae-security-alberta": [null, "Undisclosed", 5],
  "alarm-systems-ontario": [5280193, "$5.3M", 17],
  "alarme-sentinelle-sentinel-alarm-quebec": [null, "Undisclosed", 26],
  "alarmtek-smart-security-saskatchewan": [3600000, "$3.6M", 9],
  "armstrongs-a-becklar-nova-scotia": [null, "Undisclosed (Becklar subsidiary)", 11],
  "asguard-security-kosice": [null, "Undisclosed", null],
  "atlantic-alarm-sound-new-brunswick": [null, "Undisclosed", 11],
  "avante-corp-ontario": [33762000, "$33.8M (public, TSXV:XX)", 7],
  "birdseye-security-solutions-ontario": [null, "Undisclosed", 42],
  "blackline-safety-alberta": [150471008, "$150.5M (public, TSX:BLN)", 422],
  "caliber-communications-ontario": [null, "Undisclosed", null],
  "canadian-security-professionals-ontario": [4658375, "$4.7M", 13],
  "canagard-security-systems-qubec": [null, "Undisclosed", 4],
  "capitol-security-alberta": [null, "Undisclosed", 5],
  "commissionaires-bc-british-columbia": [9975691, "$10.0M", 180],
  "csa-security-ontario": [null, "Undisclosed", 19],
  "damar-security-systems-ontario": [483287, "$483K", 40],
  "eagle-vision-security-ontario": [null, "Undisclosed", 3],
  "ez-security-solutions-ontario": [null, "Undisclosed", 6],
  "fire-monitoring-of-canada-ontario": [20832307, "$20.8M", 28],
  "fire-monitoring-of-canada-ontario-2": [null, "Undisclosed (Bulldog division)", 5],
  "fusion-security-british-columbia": [null, "$5M–$25M (range)", 53],
  "globallink-response-centre": [null, "Undisclosed", null],
  "huronia-alarm-fire-security-ontario": [21200000, "$21.2M", 30],
  "iguard360-ontario": [11000000, "$11.0M", 66],
  "integrity-investigative-solutions-limited-ontario": [null, "Undisclosed", 18],
  "lanvac-surveillance-quebec": [null, "Undisclosed", 16],
  "liberty-security-a-gardaworld-alberta": [15700000, "$15.7M", 63],
  "live-patrol-remote-video-monitoring-ontario": [3500000, "$3.5M", 22],
  "maritect-solutions-atlantic-canada": [null, "Undisclosed", 10],
  "maximum-security-video-monitoring-new-brunswick": [null, "Undisclosed", 5],
  "northern911-ontario": [null, "Undisclosed", 9],
  "paladin-security-group-british-columbia": [null, "Undisclosed (~3,000 staff)", 3058],
  "paladin-technologies-british-columbia": [400000000, "$400M (Bosch-owned)", 434],
  "pcs-security-systems-ontario": [null, "Undisclosed", 4],
  "pre-lock-security-services-ontario": [6439808, "$6.4M", 11],
  "protect-ip-global-solutions-solutions-globales-quebec": [null, "Undisclosed", 15],
  "protection-plus-ontario": [190103, "$190K", 15],
  "protector-security-systems-ontario": [21347303, "$21.3M", 4],
  "protelec-security-safety-winnipeg": [3099746, "$3.1M", 15],
  "radius-security-british-columbia": [null, "Undisclosed", 54],
  "rose-security-services-british-columbia": [null, "$1M–$5M (range)", 16],
  "safetech-security-ontario": [22703066, "$22.7M", 13],
  "safewatch-live-monitoring": [null, "Undisclosed", 5],
  "scott-security-systems-british-columbia": [17650743, "$17.7M", 1],
  "scp-security-saskatchewan": [null, "Undisclosed", 2],
  "secure-shield-security-ontario": [null, "Undisclosed", 56],
  "securiforce-services-british-columbia": [null, "Undisclosed", 10],
  "securitas-nederland-utrecht": [null, "Undisclosed (Securitas AB subsidiary)", 3842],
  "security-one-alarm-systems-ontario": [5000000, "$5.0M", 24],
  "security-response-center": [null, "Undisclosed", 5],
  "sirix-remote-live-monitoring-quebec": [null, "Undisclosed", 26],
  "smart-haven-telus-trusted-provider-alberta": [null, "Undisclosed", 45],
  "synergy-protection-group-ontario": [null, "Undisclosed", 130],
  "telsco-security-systems-alberta": [35094427, "$35.1M", 38],
  "the-automated-group-ontario": [25997921, "$26.0M", 29],
  "the-lanvac-group-of-companies-quebec": [null, "Undisclosed", 16],
  "the-monitoring-center-ontario": [10000000, "$10.0M", 12],
  "tri-west-security-alberta-alberta": [null, "Undisclosed", 14],
  "trustii-qubec": [null, "Undisclosed (~$2M funding)", 23],
  "ucit-online-security-inc-merged-with-stealth-monitoring-inc-ontario": [
    12000000,
    "$12.0M (UCIT; Stealth parent ~$55.6M)",
    27,
  ],
  "unison-security-british-columbia": [null, "Undisclosed", 10],
  "united-alarm-systems-alberta": [null, "Undisclosed", 5],
  "wesecure-ontario": [null, "Undisclosed", 8],
  "zedcor-security-solutions-alberta": [16313880, "$16.3M (public, TSXV:ZDC)", 97],
};

const now = new Date().toISOString();
const stmt = db.prepare(`
  UPDATE companies
  SET revenue_usd = @usd, revenue_text = @text, employees = @emp,
      revenue_source = @src, revenue_fetched_at = @at
  WHERE slug = @slug
`);

let updated = 0;
let withFigure = 0;
const missing = [];
for (const [slug, [usd, text, emp]] of Object.entries(DATA)) {
  const res = stmt.run({
    slug,
    usd,
    text,
    emp,
    src: "Exa company data (third-party estimate; public cos. note exchange)",
    at: now,
  });
  if (res.changes === 0) missing.push(slug);
  else {
    updated++;
    if (usd != null) withFigure++;
  }
}

console.log(`Updated ${updated}/${Object.keys(DATA).length} rows.`);
console.log(`  ${withFigure} have a point revenue figure; rest are ranges/undisclosed.`);
if (missing.length) console.log("  ! slugs not matched:", missing.join(", "));
db.close();
