// Market code → display country name. The `companies.market` column (the slug
// passed to scripts/import-companies.mjs, e.g. "ca", "us") is the country axis
// across the app. Unmapped codes fall back to upper-case; "" means all countries.

const NAMES: Record<string, string> = {
  ca: "Canada",
  us: "United States",
  uk: "United Kingdom",
  gb: "United Kingdom",
  au: "Australia",
  nz: "New Zealand",
  ie: "Ireland",
  za: "South Africa",
  de: "Germany",
  fr: "France",
  es: "Spain",
  it: "Italy",
  nl: "Netherlands",
  se: "Sweden",
  cz: "Czechia",
  internal: "Internal / test",
};

export function marketName(code: string | null | undefined): string {
  if (!code) return "All countries";
  return NAMES[code.toLowerCase()] || code.toUpperCase();
}

// Codes whose flag isn't just the ISO-letters-to-regional-indicators mapping.
const FLAG_OVERRIDES: Record<string, string> = {
  uk: "🇬🇧", // monitoringstationguide uses "uk", the ISO region is "gb"
  internal: "🧪",
};

/** Emoji flag for a market code. "" → 🌍 (all), unknown non-country → 🏳️. */
export function marketFlag(code: string | null | undefined): string {
  if (!code) return "🌍";
  const c = code.toLowerCase();
  if (FLAG_OVERRIDES[c]) return FLAG_OVERRIDES[c];
  if (/^[a-z]{2}$/.test(c)) {
    const base = 0x1f1e6; // regional indicator "A"
    return String.fromCodePoint(
      base + (c.charCodeAt(0) - 97),
      base + (c.charCodeAt(1) - 97)
    );
  }
  return "🏳️";
}

export type MarketFacet = {
  market: string;
  companies: number;
  contacts: number;
};
