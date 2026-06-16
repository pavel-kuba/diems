import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { MarketFacet } from "@/lib/markets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Available countries (markets) with company + contact counts, for the header
// country switcher.
export async function GET() {
  try {
    const db = getDb();
    const markets = db
      .prepare(
        `SELECT co.market AS market,
                COUNT(DISTINCT co.id) AS companies,
                COUNT(DISTINCT ct.id) AS contacts
         FROM companies co
         LEFT JOIN contacts ct ON ct.company_id = co.id
         WHERE co.market IS NOT NULL AND co.market <> ''
         GROUP BY co.market
         ORDER BY companies DESC`
      )
      .all() as MarketFacet[];

    const totals = db
      .prepare(
        `SELECT (SELECT COUNT(*) FROM companies) AS companies,
                (SELECT COUNT(*) FROM contacts) AS contacts`
      )
      .get() as { companies: number; contacts: number };

    return NextResponse.json({ markets, totals });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Database error";
    return NextResponse.json({ error: msg, markets: [], totals: null }, { status: 500 });
  }
}
