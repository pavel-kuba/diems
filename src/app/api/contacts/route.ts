import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type ContactRow = {
  id: number;
  name: string;
  first_name: string | null;
  title: string | null;
  company: string | null;
  company_slug: string | null;
  market: string | null;
  email: string | null;
  email_type: string | null;
  email_status: string | null;
  email_confidence: number | null;
  linkedin: string | null;
  is_primary: number | null;
};

// Researched decision-maker contacts (scripts/save-contacts.mjs → SQLite),
// joined to their company name. Optional filters: ?q= and ?primary=1.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const primaryOnly = searchParams.get("primary") === "1";
  const market = (searchParams.get("market") || "").trim();

  try {
    const db = getDb();
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (q) {
      where.push(
        "(ct.name LIKE @like OR ct.email LIKE @like OR ct.title LIKE @like OR co.name LIKE @like)"
      );
      params.like = `%${q}%`;
    }
    if (primaryOnly) where.push("ct.is_primary = 1");
    if (market) {
      where.push("co.market = @market");
      params.market = market;
    }

    const rows = db
      .prepare(
        `SELECT ct.id, ct.name, ct.first_name, ct.title,
                co.name AS company, ct.company_slug, co.market AS market,
                ct.email, ct.email_type, ct.email_status, ct.email_confidence,
                ct.linkedin, ct.is_primary
         FROM contacts ct
         LEFT JOIN companies co ON co.id = ct.company_id
         ${where.length ? "WHERE " + where.join(" AND ") : ""}
         ORDER BY co.name COLLATE NOCASE, ct.is_primary DESC, ct.name COLLATE NOCASE`
      )
      .all(params) as ContactRow[];

    return NextResponse.json({ count: rows.length, contacts: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    const missing = /unable to open|fileMustExist|no such file|ENOENT/i.test(msg);
    return NextResponse.json(
      {
        error: missing
          ? "Contacts database not found. Run the research-contacts skill first."
          : msg,
        contacts: [],
        count: 0,
      },
      { status: missing ? 404 : 500 }
    );
  }
}
