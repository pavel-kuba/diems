import { NextResponse } from "next/server";
import {
  listTodos,
  addTodo,
  setTodoDone,
  updateTodoText,
  deleteTodo,
  clearDoneTodos,
} from "@/lib/outreach";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The human operator's personal to-do list. Not market-scoped — a free-form
// checklist that lives across sessions in the same DB.
export async function GET() {
  try {
    return NextResponse.json({ todos: listTodos() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg, todos: [] }, { status: 500 });
  }
}

// Add a task: { text }
export async function POST(req: Request) {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const text = (body.text || "").trim();
  if (!text) {
    return NextResponse.json({ error: "Empty task." }, { status: 400 });
  }
  try {
    return NextResponse.json({ todo: addTodo(text) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Update a task: { id, done? } toggles completion; { id, text } edits the text.
export async function PATCH(req: Request) {
  let body: { id?: number; done?: boolean; text?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const id = Number(body.id);
  if (!Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "Missing/invalid id." }, { status: 400 });
  }
  try {
    if (typeof body.done === "boolean") setTodoDone(id, body.done);
    if (typeof body.text === "string") {
      const text = body.text.trim();
      if (!text) {
        return NextResponse.json({ error: "Empty task." }, { status: 400 });
      }
      updateTodoText(id, text);
    }
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Delete one task: /api/todos?id=123 — or all completed: /api/todos?done=1
export async function DELETE(req: Request) {
  const params = new URL(req.url).searchParams;
  try {
    if (params.get("done") === "1") {
      return NextResponse.json({ ok: true, cleared: clearDoneTodos() });
    }
    const id = Number(params.get("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Missing/invalid id." }, { status: 400 });
    }
    deleteTodo(id);
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
