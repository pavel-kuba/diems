"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  SETTINGS_KEY,
  emptySettings,
  useLocalStorage,
  type Settings,
} from "@/lib/store";
import { useCountry } from "@/lib/country";
import SequenceEditor from "@/components/SequenceEditor";

type DueContact = {
  contact_id: number;
  name: string | null;
  email: string;
  company: string | null;
  current_step: number;
  next_step: number;
  days_waiting: number;
};

type SendResult = { email: string; ok: boolean; step?: number; error?: string };

const STEP_NAME: Record<number, string> = {
  1: "Bump (1/3)",
  2: "Nudge (2/3)",
  3: "Break-up (3/3)",
};

// Shorter labels for the step-filter chips.
const STEP_SHORT: Record<number, string> = {
  1: "Bump",
  2: "Nudge",
  3: "Break-up",
};

// Selected-state variant of the `.chip` class (which has no active style).
const chipActive =
  "rounded-full bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition";

export default function FollowupsPanel({
  goToSettings,
}: {
  goToSettings: () => void;
}) {
  const [settings] = useLocalStorage<Settings>(SETTINGS_KEY, emptySettings);
  const { market } = useCountry();

  const [due, setDue] = useState<DueContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [stepFilter, setStepFilter] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [results, setResults] = useState<SendResult[] | null>(null);
  const [sendTotal, setSendTotal] = useState(0);
  const [currentSend, setCurrentSend] = useState<string | null>(null);
  const cancelRef = useRef(false);
  const [showEditor, setShowEditor] = useState(false);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const from = settings.fromName
    ? `${settings.fromName} <${settings.fromEmail}>`
    : settings.fromEmail;

  const load = () => {
    setLoading(true);
    const qs = market ? `?market=${encodeURIComponent(market)}` : "";
    fetch(`/api/followups/due${qs}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          setDue((d.due as DueContact[]) || []);
          setSelected(new Set((d.due as DueContact[]).map((x) => x.contact_id)));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [market]);

  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Manually halt a person's sequence (they replied / not interested).
  const stop = async (id: number, name: string) => {
    if (!window.confirm(`Stop the follow-up sequence for ${name}?`)) return;
    await fetch("/api/outreach/mark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: id, status: "stopped" }),
    }).catch(() => {});
    load(); // they drop off the due list
  };

  // How many contacts are due for each follow-up step (drives the filter chips).
  const stepCounts = useMemo(() => {
    const m = new Map<number, number>();
    for (const d of due) m.set(d.next_step, (m.get(d.next_step) ?? 0) + 1);
    return m;
  }, [due]);

  const stepsPresent = useMemo(
    () => [...stepCounts.keys()].sort((a, b) => a - b),
    [stepCounts]
  );

  // The active step, ignoring a stale filter whose step has since emptied out
  // (e.g. after sending) — falls back to "All" without needing an effect.
  const activeStep = stepFilter != null && stepCounts.has(stepFilter) ? stepFilter : null;

  // The rows currently shown — narrowed to one follow-up step when filtering.
  const filteredDue = useMemo(
    () =>
      activeStep == null ? due : due.filter((d) => d.next_step === activeStep),
    [due, activeStep]
  );

  // Recipients = selected AND visible, so a step filter can never send to a
  // hidden contact of a different step.
  const selectedDue = useMemo(
    () => filteredDue.filter((d) => selected.has(d.contact_id)),
    [filteredDue, selected]
  );

  const canSend = !!settings.fromEmail && selectedDue.length > 0 && !sending;

  const run = async () => {
    setResults(null);
    setError(null);
    if (!settings.fromEmail) {
      setError("Set a From address in Settings first.");
      return;
    }
    if (
      selectedDue.length > 5 &&
      !window.confirm(`Send follow-ups to ${selectedDue.length} contacts now?`)
    )
      return;

    // Send one contact per request for live progress + the ability to stop.
    const list = selectedDue.slice();
    cancelRef.current = false;
    setSending(true);
    setSendTotal(list.length);
    const collected: SendResult[] = [];
    setResults([]);

    for (let i = 0; i < list.length; i++) {
      if (cancelRef.current) break;
      const d = list[i];
      setCurrentSend(d.email);
      try {
        const res = await fetch("/api/followups/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            replyTo: settings.replyTo || undefined,
            contactIds: [d.contact_id],
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          collected.push({ email: d.email, ok: false, error: data.error || "Send failed." });
        } else {
          collected.push(
            (data.results?.[0] as SendResult) ?? {
              email: d.email,
              ok: false,
              error: "skipped (no longer due)",
            }
          );
        }
      } catch (e) {
        collected.push({
          email: d.email,
          ok: false,
          error: e instanceof Error ? e.message : "Network error.",
        });
      }
      setResults([...collected]);
      if (i < list.length - 1 && !cancelRef.current) await sleep(5_000);
    }

    setCurrentSend(null);
    setSending(false);
    load(); // refresh — sent contacts advance a step and drop off the due list
  };

  const stopSending = () => {
    cancelRef.current = true;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">
          Follow-ups
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          Contacts who are due for their next step. When someone replies, hit{" "}
          <strong>Stop</strong> to take them out of the sequence. Sequence: initial →
          +2d bump → +5d nudge → +10d break-up.
        </p>
      </div>

      <div className="card">
        <button
          type="button"
          onClick={() => setShowEditor((v) => !v)}
          className="flex w-full items-center justify-between px-4 py-2.5 text-[13px] font-medium text-ink"
        >
          <span>✏️ Edit the follow-up emails (2nd / 3rd / 4th)</span>
          <span className="text-ink-faint">{showEditor ? "▾" : "▸"}</span>
        </button>
        {showEditor && (
          <div className="border-t border-line p-4">
            <SequenceEditor />
          </div>
        )}
      </div>

      {!settings.fromEmail && (
        <div className="rounded-xl border border-amber-300/70 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Set your From address in{" "}
          <button onClick={goToSettings} className="font-semibold underline">
            Settings
          </button>{" "}
          before sending follow-ups.
        </div>
      )}

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {loading && <p className="py-10 text-center text-sm text-ink-faint">Loading…</p>}

      {!loading && due.length === 0 && (
        <p className="py-10 text-center text-sm text-ink-faint">
          Nobody is due for a follow-up right now. 🎉
        </p>
      )}

      {!loading && due.length > 0 && (
        <div className="card overflow-hidden">
          {stepsPresent.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-paper/70 px-4 py-2 text-xs">
              <span className="mr-1 text-ink-muted">Follow-up:</span>
              <button
                type="button"
                onClick={() => setStepFilter(null)}
                className={activeStep == null ? chipActive : "chip"}
              >
                All ({due.length})
              </button>
              {stepsPresent.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStepFilter(s)}
                  className={activeStep === s ? chipActive : "chip"}
                >
                  {STEP_SHORT[s] ?? `Step ${s}`} ({stepCounts.get(s)})
                </button>
              ))}
            </div>
          )}
          <div className="flex items-center justify-between border-b border-line bg-paper/70 px-4 py-2 text-xs text-ink-muted">
            <span>
              {selectedDue.length} of {filteredDue.length} selected
            </span>
            <div className="flex gap-1">
              <button
                onClick={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    for (const d of filteredDue) next.add(d.contact_id);
                    return next;
                  })
                }
                className="chip"
              >
                All
              </button>
              <button
                onClick={() =>
                  setSelected((prev) => {
                    const next = new Set(prev);
                    for (const d of filteredDue) next.delete(d.contact_id);
                    return next;
                  })
                }
                className="chip"
              >
                None
              </button>
            </div>
          </div>
          <div className="divide-y divide-line/70">
            {filteredDue.map((d) => (
              <label
                key={d.contact_id}
                className="flex cursor-pointer items-start gap-3 px-4 py-2 transition hover:bg-paper/60"
              >
                <input
                  type="checkbox"
                  checked={selected.has(d.contact_id)}
                  onChange={() => toggle(d.contact_id)}
                  className="mt-1 accent-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-ink">
                      {d.name || d.email}
                    </span>
                    <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                      {STEP_NAME[d.next_step] || `Step ${d.next_step}`}
                    </span>
                  </span>
                  <span className="block truncate text-xs text-ink-faint">
                    {[d.company, d.email].filter(Boolean).join(" · ")} · waiting{" "}
                    {d.days_waiting}d
                  </span>
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    stop(d.contact_id, d.name || d.email);
                  }}
                  className="shrink-0 rounded-md px-2 py-1 text-xs text-ink-muted transition hover:bg-red-50 hover:text-red-600"
                  title="Stop the sequence for this person (replied / not interested)"
                >
                  Stop
                </button>
              </label>
            ))}
          </div>
        </div>
      )}

      {results && (
        <div className="card space-y-2 p-4">
          {(() => {
            const ok = results.filter((r) => r.ok).length;
            const fail = results.length - ok;
            const total = sending ? sendTotal : results.length;
            const pct = total ? Math.round((results.length / total) * 100) : 0;
            return (
              <>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">
                    {sending
                      ? `Sending ${results.length}/${total}…`
                      : `Done — sent ${ok}/${results.length}`}
                    <span className="ml-2 text-xs font-normal text-ink-muted">
                      {ok} ✓{fail > 0 ? ` · ${fail} ✗` : ""}
                    </span>
                  </p>
                  {sending && (
                    <button
                      type="button"
                      onClick={stopSending}
                      className="rounded-md bg-red-50 px-2 py-1 text-xs font-medium text-red-600 transition hover:bg-red-100"
                    >
                      Stop
                    </button>
                  )}
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-line/60">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
                </div>
                {sending && currentSend && (
                  <p className="text-xs text-ink-muted">Now sending: {currentSend}</p>
                )}
                <ul className="max-h-48 space-y-1 overflow-y-auto text-xs">
                  {results.map((r, i) => (
                    <li key={`${r.email}-${i}`} className={r.ok ? "text-green-700" : "text-red-600"}>
                      {r.ok ? "✓" : "✗"} {r.email}
                      {r.error ? ` — ${r.error}` : ""}
                    </li>
                  ))}
                </ul>
              </>
            );
          })()}
        </div>
      )}

      {due.length > 0 && (
        <button
          type="button"
          onClick={run}
          disabled={!canSend}
          className="btn-primary w-full py-3"
        >
          {sending
            ? `Sending… ${results?.length ?? 0}/${sendTotal}`
            : `Run follow-ups for ${selectedDue.length} contact${
                selectedDue.length === 1 ? "" : "s"
              }`}
        </button>
      )}
    </div>
  );
}
