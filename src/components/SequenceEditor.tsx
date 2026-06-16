"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Editor from "@/components/Editor";
import { applyMergeTags, buildEmailHtml } from "@/lib/email";
import {
  SETTINGS_KEY,
  emptySettings,
  useLocalStorage,
  type Settings,
} from "@/lib/store";

type Step = {
  step: number;
  offsetDays: number;
  bodyHtml: string;
  isCustom: boolean;
};

const STEP_TITLE: Record<number, string> = {
  1: "Follow-up 1 · gentle bump",
  2: "Follow-up 2 · new-angle nudge",
  3: "Follow-up 3 · break-up",
};

// Sample merge values for the live preview.
const SAMPLE = { firstName: "Jane", company: "Acme Monitoring" };

const DEFAULT_TEST_TO = "pavel.kuba@angelcam.com";

type TestState = { sending: boolean; ok?: boolean; msg?: string };

export default function SequenceEditor() {
  const [settings] = useLocalStorage<Settings>(SETTINGS_KEY, emptySettings);
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [saved, setSaved] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState(DEFAULT_TEST_TO);
  const [testState, setTestState] = useState<Record<number, TestState>>({});

  const from = settings.fromName
    ? `${settings.fromName} <${settings.fromEmail}>`
    : settings.fromEmail;

  const sendTest = useCallback(
    async (step: number, bodyHtml: string) => {
      if (!settings.fromEmail) {
        setTestState((s) => ({
          ...s,
          [step]: { sending: false, ok: false, msg: "Set a From address in Settings first." },
        }));
        return;
      }
      setTestState((s) => ({ ...s, [step]: { sending: true } }));
      try {
        const res = await fetch("/api/sequence/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            step,
            bodyHtml,
            from,
            replyTo: settings.replyTo || undefined,
            to: testTo.trim() || DEFAULT_TEST_TO,
          }),
        });
        const data = await res.json();
        setTestState((s) => ({
          ...s,
          [step]: res.ok
            ? { sending: false, ok: true, msg: `Sent to ${data.to}` }
            : { sending: false, ok: false, msg: data.error || "Send failed." },
        }));
      } catch (e) {
        setTestState((s) => ({
          ...s,
          [step]: {
            sending: false,
            ok: false,
            msg: e instanceof Error ? e.message : "Network error.",
          },
        }));
      }
    },
    [from, settings.fromEmail, settings.replyTo, testTo]
  );

  const load = useCallback(() => {
    fetch("/api/sequence")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else {
          const s = d.steps as Step[];
          setSteps(s);
          setSaved(Object.fromEntries(s.map((x) => [x.step, x.bodyHtml])));
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  useEffect(load, [load]);

  const setBody = (step: number, html: string) =>
    setSteps((prev) =>
      prev ? prev.map((s) => (s.step === step ? { ...s, bodyHtml: html } : s)) : prev
    );

  const save = async (step: number, bodyHtml: string) => {
    await fetch("/api/sequence", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step, bodyHtml }),
    }).catch(() => {});
    load();
  };

  const reset = async (step: number) => {
    if (!window.confirm("Reset this follow-up to the built-in default?")) return;
    await fetch(`/api/sequence?step=${step}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  if (error)
    return (
      <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </p>
    );
  if (!steps) return <p className="py-6 text-center text-sm text-ink-faint">Loading…</p>;

  return (
    <div className="space-y-6">
      <p className="text-xs text-ink-muted">
        These are the follow-up emails the <strong>Run follow-ups</strong> button sends.
        Each goes out as <em>“Re: your original subject”</em> so it threads under the
        first email. Merge tags <code>[First Name]</code> and <code>[Company]</code> work
        here too (a general inbox with no name greets “Hi there,”).
      </p>

      <div className="card flex flex-wrap items-center gap-2 p-3">
        <span className="text-xs font-medium text-ink">Send a test to</span>
        <input
          type="email"
          value={testTo}
          onChange={(e) => setTestTo(e.target.value)}
          placeholder={DEFAULT_TEST_TO}
          className="min-w-[16rem] flex-1 rounded-md border border-line bg-white px-2.5 py-1.5 text-sm text-ink outline-none focus:border-accent"
        />
        <span className="text-[11px] text-ink-faint">
          Uses your <strong>From</strong> address from Settings and sample values
          (Jane · Acme Monitoring). Not logged; no sequence state changes.
        </span>
      </div>

      {steps.map((s) => (
        <StepCard
          key={s.step}
          step={s}
          dirty={s.bodyHtml !== saved[s.step]}
          onChange={(html) => setBody(s.step, html)}
          onSave={() => save(s.step, s.bodyHtml)}
          onReset={() => reset(s.step)}
          test={testState[s.step]}
          onTest={() => sendTest(s.step, s.bodyHtml)}
        />
      ))}
    </div>
  );
}

function StepCard({
  step,
  dirty,
  onChange,
  onSave,
  onReset,
  test,
  onTest,
}: {
  step: Step;
  dirty: boolean;
  onChange: (html: string) => void;
  onSave: () => void;
  onReset: () => void;
  test?: TestState;
  onTest: () => void;
}) {
  const [showPreview, setShowPreview] = useState(false);
  const previewHtml = useMemo(
    () => buildEmailHtml(applyMergeTags(step.bodyHtml, SAMPLE)),
    [step.bodyHtml]
  );

  return (
    <div className="card p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-ink">
            {STEP_TITLE[step.step] || `Follow-up ${step.step}`}
          </span>
          <span className="rounded bg-line/60 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
            +{step.offsetDays} days
          </span>
          {step.isCustom ? (
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              edited
            </span>
          ) : (
            <span className="rounded bg-line/50 px-1.5 py-0.5 text-[10px] font-medium text-ink-faint">
              default
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={() => setShowPreview((v) => !v)}
            className="link"
          >
            {showPreview ? "Edit" : "Preview"}
          </button>
          {step.isCustom && (
            <button
              type="button"
              onClick={onReset}
              className="text-ink-muted underline decoration-line-strong underline-offset-2 transition hover:text-ink"
            >
              Reset to default
            </button>
          )}
        </div>
      </div>

      {showPreview ? (
        <iframe
          title={`Follow-up ${step.step} preview`}
          srcDoc={previewHtml}
          className="card h-[300px] w-full bg-white"
        />
      ) : (
        <Editor value={step.bodyHtml} onChange={onChange} />
      )}

      <div className="mt-2 flex flex-wrap items-center justify-end gap-3">
        {test?.msg && (
          <span
            className={`text-xs ${test.ok ? "text-green-700" : "text-red-600"}`}
          >
            {test.ok ? "✓" : "✗"} {test.msg}
          </span>
        )}
        {dirty && (
          <span className="text-[11px] text-ink-faint">tests the unsaved text</span>
        )}
        <button
          type="button"
          onClick={onTest}
          disabled={test?.sending}
          className="rounded-md border border-line px-3 py-1.5 text-xs font-medium text-ink transition hover:bg-paper/60 disabled:opacity-50"
        >
          {test?.sending ? "Sending…" : "Send test"}
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!dirty}
          className="btn-primary py-1.5"
        >
          {dirty ? "Save changes" : "Saved"}
        </button>
      </div>
    </div>
  );
}
