const SOURCE_URL = "https://stockanalysis.com/list/biggest-companies/";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let cache = null;

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&nbsp;/g, " ")
    .replace(/&apos;/g, "'");
}

function stripTags(value) {
  return decodeHtml(String(value || "").replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();
}

function normalizeSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "")
    .replace(/^BRK-B$/, "BRK.B")
    .slice(0, 16);
}

function parseRows(html) {
  const rows = [];
  const trMatches = html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi);

  for (const trMatch of trMatches) {
    const cells = [...trMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => stripTags(match[1]));
    if (cells.length < 3 || !/^\d+$/.test(cells[0])) continue;

    const rank = Number(cells[0]);
    const symbol = normalizeSymbol(cells[1]);
    const name = cells[2];
    if (!Number.isFinite(rank) || !symbol || !name) continue;

    rows.push({ rank, symbol, name });
  }

  return rows;
}

async function fetchMarketCapRows() {
  const response = await fetch(SOURCE_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) throw new Error(`Market cap source failed (${response.status})`);

  const html = await response.text();
  const rows = parseRows(html).slice(0, 200);
  if (rows.length < 150) throw new Error("Market cap source returned too few rows");

  return {
    source: "StockAnalysis",
    sourceUrl: SOURCE_URL,
    updatedAt: new Date().toISOString(),
    rows,
    symbols: rows.map((row) => row.symbol),
    names: Object.fromEntries(rows.map((row) => [row.symbol, row.name])),
  };
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  const now = Date.now();
  if (cache && now - cache.updatedAt < CACHE_TTL_MS) {
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      },
      body: JSON.stringify({ ok: true, data: { ...cache.value, cached: true } }),
    };
  }

  try {
    const value = await fetchMarketCapRows();
    cache = { value, updatedAt: now };
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      },
      body: JSON.stringify({ ok: true, data: value }),
    };
  } catch (error) {
    if (cache) {
      return {
        statusCode: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
        body: JSON.stringify({ ok: true, data: { ...cache.value, cached: true, stale: true } }),
      };
    }

    return {
      statusCode: 502,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: error.message || "Market cap lookup failed" }),
    };
  }
}
