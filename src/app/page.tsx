"use client";

import { useState } from "react";
import Composer from "@/components/Composer";
import ContactsPanel from "@/components/Contacts";
import CompaniesPanel from "@/components/Companies";
import FollowupsPanel from "@/components/Followups";
import SavedPanel from "@/components/Saved";
import TodosPanel from "@/components/Todos";
import SettingsPanel from "@/components/Settings";
import CountrySelector from "@/components/CountrySelector";
import { CountryProvider } from "@/lib/country";

type Tab =
  | "compose"
  | "followups"
  | "todo"
  | "saved"
  | "companies"
  | "contacts"
  | "settings";

const TABS: { id: Tab; label: string }[] = [
  { id: "compose", label: "Compose" },
  { id: "followups", label: "Follow-ups" },
  { id: "companies", label: "Companies" },
  { id: "contacts", label: "Contacts" },
  { id: "settings", label: "Settings" },
  { id: "saved", label: "Saved" },
  { id: "todo", label: "To-do" },
];

export default function Home() {
  const [tab, setTab] = useState<Tab>("compose");

  return (
    <CountryProvider>
      <main className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-line/50 bg-paper/80 backdrop-blur-xl">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-2.5">
            <div className="flex items-baseline gap-2.5">
              <h1 className="text-[17px] font-semibold tracking-tight text-ink">
                diems
              </h1>
              <span className="hidden text-xs text-ink-faint sm:inline">
                outreach to monitoring stations
              </span>
            </div>
            <div className="flex items-center gap-3">
              <CountrySelector />
              {/* Segmented control */}
              <nav className="flex rounded-lg bg-[#e9e9eb] p-0.5">
                {TABS.map((t) => {
                  const active = tab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setTab(t.id)}
                      className={`rounded-[7px] px-3 py-1 text-[13px] transition ${
                        active
                          ? "bg-surface font-medium text-ink shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
                          : "text-ink-muted hover:text-ink"
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        </header>

        <div className="mx-auto max-w-6xl px-6 py-5">
          {tab === "compose" && (
            <Composer goToSettings={() => setTab("settings")} />
          )}
          {tab === "followups" && (
            <FollowupsPanel goToSettings={() => setTab("settings")} />
          )}
          {tab === "todo" && <TodosPanel />}
          {tab === "saved" && <SavedPanel />}
          {tab === "companies" && <CompaniesPanel />}
          {tab === "contacts" && <ContactsPanel />}
          {tab === "settings" && <SettingsPanel />}
        </div>
      </main>
    </CountryProvider>
  );
}
