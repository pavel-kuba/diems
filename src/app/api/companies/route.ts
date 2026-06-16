import { NextResponse } from "next/server";
import { getDb, type CompanyRow } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const market = (searchParams.get("market") || "").trim();

  try {
    const db = getDb();

    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (q) {
      where.push(
        "(name LIKE @like OR city LIKE @like OR region LIKE @like OR website LIKE @like OR description LIKE @like)"
      );
      params.like = `%${q}%`;
    }
    if (market) {
      where.push("market = @market");
      params.market = market;
    }
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";

    const rows = db
      .prepare(
        `SELECT id, name, website, city, region, country, description, market, detail_url
         FROM companies
         ${whereSql}
         ORDER BY name COLLATE NOCASE`
      )
      .all(params) as CompanyRow[];

    const total = (
      db.prepare("SELECT COUNT(*) n FROM companies").get() as { n: number }
    ).n;

    return NextResponse.json({ total, count: rows.length, companies: rows });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    const missing = /unable to open|fileMustExist|no such file|ENOENT/i.test(
      msg
    );
    return NextResponse.json(
      {
        error: missing
          ? "Company database not found. Run: node scripts/import-companies.mjs"
          : msg,
        companies: [],
        total: 0,
        count: 0,
      },
      { status: missing ? 404 : 500 }
    );
  }
}
