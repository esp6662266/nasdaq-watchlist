const MAX_PAIN_TTL_MS = 30 * 60 * 1000;
const maxPainCache = new Map();

function normalizeStockSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "")
    .slice(0, 12);
}

function parseNumeric(value) {
  const parsed = Number(String(value ?? "").trim().replace(/[,$\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMaxPainHtml(symbol, html) {
  const strike =
    parseNumeric(html.match(/"max_pain_strike"\s*:\s*([0-9.]+)/)?.[1]) ||
    parseNumeric(html.match(/Max Pain:\s*'\s*\+\s*'([0-9,.]+)/)?.[1]) ||
    parseNumeric(html.match(/is\s*<b>\$?([0-9,.]+)<\/b>/i)?.[1]);

  if (!Number.isFinite(strike)) return null;

  const expirationHtml = html.match(/options expiring on\s*<b>([\s\S]*?)<\/b>/i)?.[1] || "";
  const expiration = stripTags(expirationHtml);
  const expirationDate = html.match(/expiration_date=([0-9-]+(?::[a-z])?)/i)?.[1]?.replace(":", ":") || null;

  return {
    symbol,
    strike,
    expiration,
    expirationDate,
    source: "OptionCharts",
    sourceUrl: `https://optioncharts.io/options/${encodeURIComponent(symbol)}/max-pain`,
    updatedAt: new Date().toISOString(),
  };
}

async function fetchMaxPain(symbol) {
  const now = Date.now();
  const cached = maxPainCache.get(symbol);
  if (cached && now - cached.updatedAt < MAX_PAIN_TTL_MS) return { ...cached.value, cached: true };

  const url = `https://optioncharts.io/async/options_charts/max_pain?ticker=${encodeURIComponent(symbol)}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 stock-watchlist-netlify-app",
      accept: "text/html,application/xhtml+xml",
      "hx-request": "true",
      referer: `https://optioncharts.io/options/${encodeURIComponent(symbol)}/max-pain`,
    },
  });

  if (!response.ok) throw new Error(`OptionCharts request failed for ${symbol}`);

  const html = await response.text();
  const parsed = parseMaxPainHtml(symbol, html);
  if (!parsed) return { symbol, error: "맥스페인 데이터 없음" };

  maxPainCache.set(symbol, { value: parsed, updatedAt: now });
  return parsed;
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
    const rawSymbols = event.queryStringParameters?.symbols || event.queryStringParameters?.symbol || "";
    const symbols = [
      ...new Set(
        String(rawSymbols)
          .split(",")
          .map(normalizeStockSymbol)
          .filter(Boolean),
      ),
    ].slice(0, 10);

    if (symbols.length === 0) throw new Error("symbol query is required");

    const entries = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          return [symbol, await fetchMaxPain(symbol)];
        } catch (error) {
          return [symbol, { symbol, error: error.message || "맥스페인 조회 실패" }];
        }
      }),
    );

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "public, max-age=600, stale-while-revalidate=1800",
      },
      body: JSON.stringify({ ok: true, maxPain: Object.fromEntries(entries) }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: error.message || "Max pain lookup failed" }),
    };
  }
}
