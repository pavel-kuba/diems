"use client";

import { useCallback, useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

// NOTE: researched contacts live in SQLite (see src/lib/contacts.ts +
// /api/contacts), not localStorage. localStorage here holds only Settings.

export type Settings = {
  // Resend API key is loaded server-side from the RESEND_API_KEY env var,
  // never stored in the browser.
  fromName: string;
  fromEmail: string;
  replyTo: string;
};

export const SETTINGS_KEY = "diems.settings";

export const emptySettings: Settings = {
  fromName: "",
  fromEmail: "",
  replyTo: "",
};

/* ------------------------------------------------------------------ */
/* localStorage hook (SSR-safe)                                       */
/* ------------------------------------------------------------------ */

export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  // Read once on mount (client only) to avoid hydration mismatch.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw !== null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore corrupt data */
    }
    setLoaded(true);
  }, [key]);

  // Persist on change (after the initial read).
  useEffect(() => {
    if (!loaded) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* quota / private mode — ignore */
    }
  }, [key, value, loaded]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => setValue(next),
    []
  );

  return [value, update, loaded] as const;
}
