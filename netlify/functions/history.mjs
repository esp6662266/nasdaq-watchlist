const PUBLIC_API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "https://esp6662266.github.io",
};

const HISTORY_TTL_MS = 30 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 4000;
const historyCache = new Map();

function normalizeStockSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "")
    .slice(0, 12);
}

async function fetchCachedHistory(symbol, refresh) {
  const cached = historyCache.get(symbol);
  if (!refresh && cached && Date.now() - cached.updatedAt < HISTORY_TTL_MS) return cached;

  for (const [source, fetchProvider] of [["Yahoo Finance", fetchYahooHistory], ["StockAnalysis", fetchStockAnalysisHistory]]) {
    const rows = await fetchProvider(symbol).catch(() => []);
    if (rows.length === 0) continue;

    const updatedAt = Date.now();
    const result = { rows, updatedAt, meta: {
      source,
      fetchedAt: new Date(updatedAt).toISOString(),
      latestSessionDate: rows.at(-1).time,
      stale: false,
      status: "available",
    } };
    historyCache.set(symbol, result);
    return result;
  }

  const lastSuccessful = historyCache.get(symbol);
  if (lastSuccessful) return { ...lastSuccessful, meta: { ...lastSuccessful.meta, stale: true } };
  return { rows: [], meta: { source: null, fetchedAt: null, latestSessionDate: null, stale: false, status: "unavailable" } };
}

function parseNumeric(value) {
  const clean = String(value ?? "").trim().replace(/[,$\s]/g, "");
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function validCandles(rows) {
  return rows.filter(({ time, open, high, low, close }) =>
    /^\d{4}-\d{2}-\d{2}$/.test(time) &&
    [open, high, low, close].every((price) => Number.isFinite(price) && price > 0) &&
    high >= Math.max(open, close) && low <= Math.min(open, close),
  ).sort((a, b) => a.time.localeCompare(b.time)).slice(-320);
}

async function fetchYahooHistory(symbol) {
  if (!/^[A-Z0-9.-]+$/.test(symbol)) return [];

  const yahooSymbol = encodeURIComponent(symbol.replace(/\./g, "-"));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?range=2y&interval=1d&includePrePost=false`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: {
      "user-agent": "Mozilla/5.0 stock-watchlist-netlify-app",
      accept: "application/json",
    },
  });

  if (!response.ok) return [];

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const adjustedClose = result?.indicators?.adjclose?.[0]?.adjclose || [];

  return validCandles(timestamps.map((timestamp, index) => ({
      time: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString().slice(0, 10) : null,
      open: parseNumeric(quote.open?.[index]),
      high: parseNumeric(quote.high?.[index]),
      low: parseNumeric(quote.low?.[index]),
      close: parseNumeric(quote.close?.[index]),
      adjustedClose: parseNumeric(adjustedClose[index]),
      volume: parseNumeric(quote.volume?.[index]),
    })));
}

async function fetchStockAnalysisHistory(symbol) {
  let html = "";
  const slug = encodeURIComponent(symbol.toLowerCase().replace(/\./g, "-"));

  for (const type of ["stocks", "etf"]) {
    const url = `https://stockanalysis.com/${type}/${slug}/history/`;
    const response = await fetch(url, {
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
      headers: {
        "user-agent": "Mozilla/5.0 stock-watchlist-netlify-app",
      },
    });

    if (response.ok) {
      html = await response.text();
      break;
    }
  }

  if (!html) return [];

  const section =
    html.match(/data:\[(\{a:[\s\S]+?)\],created_at:[\s\S]{0,160}?source:"spg"/)?.[1] ||
    html.match(/data:\[(\{a:[\s\S]+?)\],created_at:/)?.[1] ||
    "";

  const candles = [];
  const rowPattern = /\{a:([^,}]+),c:([^,}]+),h:([^,}]+),l:([^,}]+),o:([^,}]+),t:"([^"]+)",v:([^,}]+)/g;
  let match;

  while ((match = rowPattern.exec(section))) {
    const [, adjustedClose, close, high, low, open, date, volume] = match;
    candles.push({
      time: date,
      open: parseNumeric(open),
      high: parseNumeric(high),
      low: parseNumeric(low),
      close: parseNumeric(close),
      adjustedClose: parseNumeric(adjustedClose),
      volume: parseNumeric(volume),
    });
  }

  return validCandles(candles);
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: PUBLIC_API_HEADERS,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  try {
    const refreshParam = event.queryStringParameters?.refresh;
    const refresh = refreshParam !== undefined && String(refreshParam).toLowerCase() !== "false";
    const symbols = [
      ...new Set(
        String(event.queryStringParameters?.symbols || "")
          .split(",")
          .map(normalizeStockSymbol)
          .filter(Boolean),
      ),
    ].slice(0, 30);

    if (symbols.length === 0) throw new Error("symbols query is required");

    const entries = await Promise.all(
      symbols.map(async (symbol) => [symbol, await fetchCachedHistory(symbol, refresh)]),
    );

    return {
      statusCode: 200,
      headers: {
        ...PUBLIC_API_HEADERS,
        "cache-control": refresh || entries.some(([, { meta }]) => meta.stale || meta.status === "unavailable")
          ? "no-store" : "public, max-age=600, stale-while-revalidate=1800",
      },
      body: JSON.stringify({
        ok: true,
        history: Object.fromEntries(entries.map(([symbol, { rows }]) => [symbol, rows])),
        meta: Object.fromEntries(entries.map(([symbol, { meta }]) => [symbol, meta])),
      }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: PUBLIC_API_HEADERS,
      body: JSON.stringify({ ok: false, error: error.message || "History lookup failed" }),
    };
  }
}
