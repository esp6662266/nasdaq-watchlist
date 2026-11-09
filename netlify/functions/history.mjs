const HISTORY_TTL_MS = 30 * 60 * 1000;
const historyCache = new Map();

function normalizeStockSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "")
    .slice(0, 12);
}

async function fetchCachedHistory(symbol) {
  const now = Date.now();
  const cached = historyCache.get(symbol);

  if (cached && now - cached.updatedAt < HISTORY_TTL_MS) return cached.value;

  try {
    const yahooValue = await fetchYahooHistory(symbol);
    const value = yahooValue.length > 0 ? yahooValue : await fetchStockAnalysisHistory(symbol);
    if (value.length > 0) historyCache.set(symbol, { value, updatedAt: now });
    return value.length > 0 ? value : cached?.value || [];
  } catch {
    return cached?.value || [];
  }
}

function parseNumeric(value) {
  const parsed = Number(String(value ?? "").trim().replace(/[,$\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

async function fetchYahooHistory(symbol) {
  if (!/^[A-Z0-9.-]+$/.test(symbol)) return [];

  const yahooSymbol = encodeURIComponent(symbol.replace(/\./g, "-"));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?range=2y&interval=1d&includePrePost=false`;
  const response = await fetch(url, {
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

  return timestamps
    .map((timestamp, index) => ({
      time: new Date(timestamp * 1000).toISOString().slice(0, 10),
      open: parseNumeric(quote.open?.[index]),
      high: parseNumeric(quote.high?.[index]),
      low: parseNumeric(quote.low?.[index]),
      close: parseNumeric(quote.close?.[index]),
      adjustedClose: parseNumeric(adjustedClose[index]),
      volume: parseNumeric(quote.volume?.[index]),
    }))
    .filter((candle) =>
      [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value)),
    )
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(-320);
}

async function fetchStockAnalysisHistory(symbol) {
  if (!/^[A-Z0-9-]+$/.test(symbol)) return [];

  let html = "";
  const slug = encodeURIComponent(symbol.toLowerCase());

  for (const type of ["stocks", "etf"]) {
    const url = `https://stockanalysis.com/${type}/${slug}/history/`;
    const response = await fetch(url, {
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

  return candles
    .filter((candle) =>
      [candle.open, candle.high, candle.low, candle.close].every((value) => Number.isFinite(value)),
    )
    .sort((a, b) => a.time.localeCompare(b.time))
    .slice(-320);
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  try {
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
      symbols.map(async (symbol) => [symbol, await fetchCachedHistory(symbol)]),
    );

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=600, stale-while-revalidate=1800",
      },
      body: JSON.stringify({ ok: true, history: Object.fromEntries(entries) }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: error.message || "History lookup failed" }),
    };
  }
}
