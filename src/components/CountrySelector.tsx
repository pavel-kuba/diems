"use client";

import { useEffect, useState } from "react";
import { useCountry } from "@/lib/country";
import { marketFlag, marketName, type MarketFacet } from "@/lib/markets";

// Header country switcher — scopes every tab to the selected market.
export default function CountrySelector() {
  const { market, setMarket } = useCountry();
  const [markets, setMarkets] = useState<MarketFacet[]>([]);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/markets")
      .then((r) => r.json())
      .then((d) => {
        setMarkets((d.markets as MarketFacet[]) || []);
        setTotal(d.totals?.companies ?? null);
      })
      .catch(() => {
        /* selector still works, just without counts */
      });
  }, []);

  return (
    <label className="flex items-center gap-1.5 text-xs text-ink-muted">
      <span className="hidden sm:inline">Country</span>
      <select
        value={market}
        onChange={(e) => setMarket(e.target.value)}
        title="Scope the whole app to one country"
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/15"
      >
        <option value="">
          🌍 All countries{total != null ? ` (${total})` : ""}
        </option>
        {markets.map((m) => (
          <option key={m.market} value={m.market}>
            {marketFlag(m.market)} {marketName(m.market)} ({m.companies})
          </option>
        ))}
      </select>
    </label>
  );
}
