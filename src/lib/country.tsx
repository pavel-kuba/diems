"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";

// Selected country (market code) shared across all tabs, persisted in
// localStorage. "" means "All countries".
const KEY = "diems.market";

type CountryCtx = { market: string; setMarket: (m: string) => void };

const Ctx = createContext<CountryCtx>({ market: "", setMarket: () => {} });

export function CountryProvider({ children }: { children: React.ReactNode }) {
  const [market, setMarketState] = useState("");

  useEffect(() => {
    try {
      const v = localStorage.getItem(KEY);
      if (v !== null) setMarketState(v);
    } catch {
      /* localStorage unavailable */
    }
  }, []);

  const setMarket = useCallback((m: string) => {
    setMarketState(m);
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* ignore */
    }
  }, []);

  return <Ctx.Provider value={{ market, setMarket }}>{children}</Ctx.Provider>;
}

export function useCountry(): CountryCtx {
  return useContext(Ctx);
}
