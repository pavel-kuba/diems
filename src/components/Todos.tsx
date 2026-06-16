"use client";

import { useCallback, useEffect, useState } from "react";

// A plain personal to-do list for the human operator — manual reminders that
// the app can't derive ("call NYPD to ID the decision-maker", "reply to Barry
// Dempsey"). Stored in monitoring.db (the `todos` table), not market-scoped, so
// it persists across sessions. See /api/todos + lib/outreach.ts.
type Todo = {
  id: number;
  text: string;
  done: number; // 0 | 1
  created_at: string;
  done_at: string | null;
};

// Soft pastel tints for the bento tiles (same palette as the Saved tab). The
// colour is seeded from the task id, so a tile keeps its colour across reloads
// and re-sorts — colour is decoration, not meaning.
const TINTS = [
  "border-sky-200/70 bg-sky-50",
  "border-emerald-200/70 bg-emerald-50",
  "border-amber-200/70 bg-amber-50",
  "border-violet-200/70 bg-violet-50",
  "border-rose-200/70 bg-rose-50",
  "border-teal-200/70 bg-teal-50",
];

const tintFor = (seed: number) => TINTS[seed % TINTS.length];

export default function TodosPanel() {
  const [todos, setTodos] = useState<Todo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/todos")
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setTodos((d.todos as Todo[]) || []);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const add = async () => {
    const text = draft.trim();
    if (!text || adding) return;
    setAdding(true);
    try {
      await fetch("/api/todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      setDraft("");
      load();
    } catch {
      /* ignore — load() reflects the real state */
    } finally {
      setAdding(false);
    }
  };

  const toggle = async (t: Todo) => {
    // Optimistic flip; reload to re-sort (done items drop to the bottom).
    setTodos((prev) =>
      prev.map((x) => (x.id === t.id ? { ...x, done: x.done ? 0 : 1 } : x))
    );
    await fetch("/api/todos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, done: !t.done }),
    }).catch(() => {});
    load();
  };

  const editText = async (t: Todo) => {
    const text = window.prompt("Edit task", t.text);
    if (text === null) return;
    const trimmed = text.trim();
    if (!trimmed || trimmed === t.text) return;
    await fetch("/api/todos", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: t.id, text: trimmed }),
    }).catch(() => {});
    load();
  };

  const remove = async (t: Todo) => {
    await fetch(`/api/todos?id=${t.id}`, { method: "DELETE" }).catch(() => {});
    load();
  };

  const clearDone = async () => {
    if (!window.confirm("Remove all completed tasks?")) return;
    await fetch("/api/todos?done=1", { method: "DELETE" }).catch(() => {});
    load();
  };

  const open = todos.filter((t) => !t.done);
  const done = todos.filter((t) => t.done);

  // One bento tile per task. Active tasks get a seeded pastel tint; completed
  // ones drop the colour and recede (struck through, dimmed).
  const tile = (t: Todo) => (
    <div
      key={t.id}
      className={`card group mb-3 flex break-inside-avoid items-start gap-3 p-3.5 ${
        t.done ? "opacity-70" : tintFor(t.id)
      }`}
    >
      <button
        type="button"
        onClick={() => toggle(t)}
        aria-label={t.done ? "Mark as not done" : "Mark as done"}
        className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition ${
          t.done
            ? "border-accent bg-accent text-white"
            : "border-line bg-white hover:border-accent"
        }`}
      >
        {t.done ? "✓" : ""}
      </button>
      <button
        type="button"
        onClick={() => editText(t)}
        title="Click to edit"
        className={`min-w-0 flex-1 text-left text-sm leading-relaxed transition ${
          t.done ? "text-ink-faint line-through" : "text-ink"
        }`}
      >
        {t.text}
      </button>
      <button
        type="button"
        onClick={() => remove(t)}
        className="shrink-0 rounded-md px-2 py-0.5 text-xs text-ink-faint opacity-0 transition hover:bg-red-50 hover:text-red-600 group-hover:opacity-100"
      >
        Delete
      </button>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="max-w-2xl">
        <h2 className="text-xl font-semibold tracking-tight text-ink">To-do</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Your personal checklist — manual reminders the app can&apos;t track for
          you (calls to make, replies to send, things to circle back to). Click a
          task to edit it; check it off when done.
        </p>
      </div>

      {/* Add a task */}
      <div className="card flex max-w-2xl items-center gap-2 p-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
          placeholder="Add a task…"
          className="min-w-0 flex-1 bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-faint"
        />
        <button
          type="button"
          onClick={add}
          disabled={!draft.trim() || adding}
          className="shrink-0 rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
        >
          Add
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {loading && (
        <p className="py-10 text-center text-sm text-ink-faint">Loading…</p>
      )}
      {!loading && !error && todos.length === 0 && (
        <p className="py-10 text-center text-sm text-ink-faint">
          Nothing to do yet. Add your first task above.
        </p>
      )}

      {/* Open tasks — bento masonry; varied-height tiles pack gap-free. */}
      {open.length > 0 && (
        <div className="gap-3 sm:columns-2 lg:columns-3">{open.map(tile)}</div>
      )}

      {/* Completed tasks */}
      {done.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
              Done · {done.length}
            </p>
            <button
              type="button"
              onClick={clearDone}
              className="rounded-md px-2 py-0.5 text-xs text-ink-muted transition hover:bg-line/40 hover:text-ink"
            >
              Clear completed
            </button>
          </div>
          <div className="gap-3 sm:columns-2 lg:columns-3">{done.map(tile)}</div>
        </div>
      )}
    </div>
  );
}
