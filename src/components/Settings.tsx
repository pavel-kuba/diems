"use client";

import { useEffect, useState } from "react";
import {
  SETTINGS_KEY,
  emptySettings,
  useLocalStorage,
  type Settings,
} from "@/lib/store";

export default function SettingsPanel() {
  const [settings, setSettings] = useLocalStorage<Settings>(
    SETTINGS_KEY,
    emptySettings
  );
  const [keyConfigured, setKeyConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/send")
      .then((r) => r.json())
      .then((d) => setKeyConfigured(!!d.configured))
      .catch(() => setKeyConfigured(false));
  }, []);

  const set = (patch: Partial<Settings>) =>
    setSettings((s) => ({ ...s, ...patch }));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-ink">
          Settings
        </h2>
        <p className="mt-1 text-sm text-ink-muted">
          From details are stored only in this browser (localStorage). The Resend
          API key is loaded from the server environment, never the browser.
        </p>
      </div>

      <Field
        label="Resend API key"
        hint={
          <>
            Set the <code className="rounded bg-line/60 px-1">RESEND_API_KEY</code>{" "}
            environment variable in{" "}
            <code className="rounded bg-line/60 px-1">.env.local</code> (then
            restart the dev server). Create a key at{" "}
            <a
              href="https://resend.com/api-keys"
              target="_blank"
              rel="noreferrer"
              className="link"
            >
              resend.com/api-keys
            </a>
            .
          </>
        }
      >
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            keyConfigured === null
              ? "border-line bg-paper/70 text-ink-muted"
              : keyConfigured
                ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          {keyConfigured === null && "Checking environment…"}
          {keyConfigured === true && "✓ RESEND_API_KEY is configured on the server."}
          {keyConfigured === false &&
            "⚠ RESEND_API_KEY is not set. Add it to .env.local and restart."}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="From name" hint="e.g. Pavel Kuba">
          <Input
            value={settings.fromName}
            onChange={(v) => set({ fromName: v })}
            placeholder="Pavel Kuba"
          />
        </Field>
        <Field
          label="From email"
          hint="Must be on a domain verified in Resend."
        >
          <Input
            value={settings.fromEmail}
            onChange={(v) => set({ fromEmail: v.trim() })}
            placeholder="pavel@yourdomain.com"
          />
        </Field>
      </div>

      <Field
        label="Reply-to (optional)"
        hint="Where replies should go, if different from the From address."
      >
        <Input
          value={settings.replyTo}
          onChange={(v) => set({ replyTo: v.trim() })}
          placeholder="pavel.kuba@angelcam.com"
        />
      </Field>

      <div className="card p-4 text-sm text-ink-muted">
        <p className="font-medium text-ink">Preview of your From header</p>
        <p className="mt-1 font-mono">
          {settings.fromName && settings.fromEmail
            ? `${settings.fromName} <${settings.fromEmail}>`
            : settings.fromEmail || "— set a From email above —"}
        </p>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {hint && <p className="mt-1 text-xs text-ink-faint">{hint}</p>}
    </label>
  );
}

function Input({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="input mt-1"
    />
  );
}
