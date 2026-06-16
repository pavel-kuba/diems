"use client";

import { useEffect, useState } from "react";
import { useCountry } from "@/lib/country";

type Company = {
  id: number;
  name: string;
  website: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  description: string | null;
  market: string;
  detail_url: string | null;
};

export default function CompaniesPanel() {
  const { market } = useCountry();
  const [query, setQuery] = useState("");
  const [companies, setCompanies] = useState<Company[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Debounce the search so we don't hit the API on every keystroke.
  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch(
        `/api/companies?q=${encodeURIComponent(query)}${
          market ? `&market=${encodeURIComponent(market)}` : ""
        }`,
        { signal: ctrl.signal }
      )
        .then((r) => r.json())
        .then((d) => {
          if (d.error) {
            setError(d.error);
            setCompanies([]);
            setTotal(0);
          } else {
            setCompanies(d.companies);
            setTotal(d.total);
          }
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError("Failed to load companies.");
        })
        .finally(() => setLoading(false));
    }, 200);

    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [query, market]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xl font-semibold tracking-tight text-ink">
          Companies
        </h2>
        <span className="text-sm text-ink-muted">
          {query
            ? `${companies.length} match${companies.length === 1 ? "" : "es"}`
            : market
              ? `${companies.length} monitoring stations`
              : total !== null
                ? `${total} monitoring stations`
                : ""}
        </span>
      </div>

      <input
        type="search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, city, province, website or description…"
        className="input px-4 py-2.5"
      />

      {error && (
        <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {error}
        </div>
      )}

      {loading && companies.length === 0 && !error && (
        <p className="py-8 text-center text-sm text-ink-faint">Loading…</p>
      )}

      {!loading && !error && companies.length === 0 && (
        <p className="py-8 text-center text-sm text-ink-faint">
          No companies match “{query}”.
        </p>
      )}

      <div className="card divide-y divide-line/70 overflow-hidden">
        {companies.map((c) => (
          <div key={c.id} className="px-4 py-2 transition hover:bg-paper/60">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{c.name}</p>
                <p className="text-xs text-ink-muted">
                  {[c.city, c.region].filter(Boolean).join(", ") ||
                    "Location not listed"}
                </p>
              </div>
              {c.website && (
                <a
                  href={c.website}
                  target="_blank"
                  rel="noreferrer"
                  className="link shrink-0 text-xs"
                >
                  {prettyHost(c.website)}
                </a>
              )}
            </div>
            {c.description && (
              <p className="mt-1 line-clamp-2 text-xs text-ink-faint">
                {clean(c.description)}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function prettyHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
