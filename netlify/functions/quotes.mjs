const PUBLIC_API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "https://esp6662266.github.io",
};

const QUOTE_TTL_MS = 30_000;
const PE_TTL_MS = 12 * 60 * 60 * 1000;
const PROVIDER_TIMEOUT_MS = 4000;
const quoteCache = new Map();
const peCache = new Map();

function normalizeStockSymbol(value) {
  const symbol = String(value || "").trim().toUpperCase();
  if (symbol.startsWith("^")) return /^\^[A-Z0-9.-]{1,11}$/.test(symbol) ? symbol : "";
  return symbol.replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}

function toLookupSymbol(symbol) {
  return symbol.replace(/\./g, "-");
}

function getStockAnalysisSlugs(symbol) {
  return [
    String(symbol || "").toLowerCase(),
    toLookupSymbol(symbol).toLowerCase(),
  ].filter((value, index, values) => /^[a-z0-9.-]+$/.test(value) && values.indexOf(value) === index);
}

function toStooqSymbol(symbol) {
  const lookupSymbol = toLookupSymbol(symbol);
  return `${lookupSymbol.toLowerCase()}.us`;
}

function parseNumeric(value) {
  const clean = String(value ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(/[,$]/g, "");
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function parsePrice(value) {
  const price = parseNumeric(value);
  return price > 0 ? price : null;
}

function timestampIso(value) {
  const timestamp = parsePrice(value);
  return timestamp != null && timestamp <= 8.64e12 ? new Date(timestamp * 1000).toISOString() : null;
}

function displayQuoteTime(asOf) {
  if (!asOf) return { date: "", time: "" };
  const quoteTime = new Date(asOf);
  return {
    date: quoteTime.toLocaleDateString("ko-KR", { timeZone: "America/New_York" }),
    time: quoteTime.toLocaleTimeString("ko-KR", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit" }),
  };
}

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

function parseStockAnalysisChartQuote(html) {
  const chartMatch = html.match(/chart:\{[\s\S]*?data:\[([\s\S]*?)\]\},changes:/i);
  if (!chartMatch) return null;

  const points = [...chartMatch[1].matchAll(/\{c:([0-9]+(?:\.[0-9]+)?)/gi)]
    .map((match) => parseNumeric(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (points.length === 0) return null;

  return {
    close: points[points.length - 1],
    high: Math.max(...points),
    low: Math.min(...points),
  };
}

async function fetchStooqQuote(symbol) {
  const stooqSymbol = toStooqSymbol(symbol);
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcvcp&h&e=csv`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: {
      "user-agent": "Mozilla/5.0 stock-watchlist-netlify-app",
    },
  });

  if (!response.ok) {
    throw new Error(`Stooq request failed for ${symbol}`);
  }

  const text = await response.text();
  const lines = text.trim().split(/\r?\n/);
  const dataLine = lines[0]?.toLowerCase().startsWith("symbol") ? lines[1] : lines[0];
  const row = parseCsvLine(dataLine || "");
  const open = parsePrice(row[3]);
  const close = parsePrice(row[6]);
  const headers = parseCsvLine(lines[0] || "");
  const previousCloseIndex = headers.findIndex((header) => /^(previous|prev\.?)\s+close$/i.test(header.trim()));
  const previousClose = parsePrice(row[previousCloseIndex]);
  if (close == null) return null;

  const change = Number.isFinite(previousClose) ? close - previousClose : null;
  const changePercent =
    Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : null;

  return {
    symbol,
    sourceSymbol: row[0],
    source: "Stooq",
    asOf: null,
    session: "unknown",
    date: row[1] || "",
    time: row[2] || "",
    open,
    high: parsePrice(row[4]),
    low: parsePrice(row[5]),
    previousClose,
    close,
    volume: parseNumeric(row[7]),
    change,
    changePercent,
  };
}

async function fetchStockAnalysisQuote(symbol) {
  let html = "";
  let assetType = "stock";

  for (const slug of getStockAnalysisSlugs(symbol)) {
    for (const type of ["stocks", "etf"]) {
      const url = `https://stockanalysis.com/${type}/${encodeURIComponent(slug)}/`;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
        headers: {
          "user-agent": "Mozilla/5.0 stock-watchlist-netlify-app",
        },
      });

      if (response.ok) {
        html = await response.text();
        assetType = type === "etf" ? "etf" : "stock";
        break;
      }
    }
    if (html) break;
  }

  if (!html) return null;

  const chartQuote = parseStockAnalysisChartQuote(html);
  const header = html.match(/class="text-4xl[^>]*>\s*([0-9,.]+)<\/div>([\s\S]{0,550})/i);
  const headerClose = parsePrice(header?.[1]);
  const close = headerClose ?? chartQuote?.close;
  const dateLabel = header?.[2].match(/(?:At close:|As of:)\s*<\/span>\s*([A-Z][a-z]{2} \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M E[DS]T)/i)?.[1];
  const timestamp = Date.parse(dateLabel?.replace(/EST$/i, "GMT-0500").replace(/EDT$/i, "GMT-0400") ?? "");
  const asOf = headerClose != null && Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  const previousClose = parsePrice(
    html.match(/Previous Close<\/td><td[^>]*>\s*([0-9,.]+)/i)?.[1],
  );
  const volume = parseNumeric(html.match(/Volume<\/td><td[^>]*>\s*([0-9,.]+)/i)?.[1]);
  const rangeMatch = html.match(/Day's Range<\/td><td[^>]*>\s*([0-9,.]+)\s*-\s*([0-9,.]+)/i);

  if (!Number.isFinite(close) || close <= 0) return null;

  const change = Number.isFinite(previousClose) ? close - previousClose : null;
  const changePercent =
    Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : null;

  return {
    symbol,
    sourceSymbol: `${symbol}.US`,
    source: "StockAnalysis",
    asOf,
    session: asOf ? "regular" : "unknown",
    ...displayQuoteTime(asOf),
    open: null,
    high: parsePrice(rangeMatch?.[2]) ?? chartQuote?.high ?? null,
    low: parsePrice(rangeMatch?.[1]) ?? chartQuote?.low ?? null,
    previousClose,
    close,
    volume,
    change,
    changePercent,
    assetType,
  };
}

function marketPeriod(meta, key, timestamp) {
  if (timestamp == null) return undefined;
  const periods = meta.tradingPeriods?.[key];
  return [meta.currentTradingPeriod?.[key], ...(Array.isArray(periods) ? periods.flat() : [])]
    .find((period) => period && timestamp >= period.start && timestamp <= period.end);
}

function barSession(meta, timestamp) {
  if (marketPeriod(meta, "regular", timestamp)) return "regular";
  if (marketPeriod(meta, "pre", timestamp)) return "premarket";
  if (marketPeriod(meta, "post", timestamp)) return "afterhours";
  return "unknown";
}

async function fetchYahooQuote(symbol) {
  const lookupSymbol = toLookupSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(lookupSymbol)}?range=1d&interval=1m&includePrePost=true`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: {
      "user-agent": "Mozilla/5.0 stock-watchlist-netlify-app",
    },
  });

  if (!response.ok) return null;

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const timestamps = result?.timestamp || [];
  const regular = {
    close: parsePrice(meta.regularMarketPrice),
    timestamp: parsePrice(meta.regularMarketTime),
    session: "regular",
  };
  const lastIndex = (quote.close || []).findLastIndex((value) => parsePrice(value) != null);
  const lastTimestamp = parsePrice(timestamps[lastIndex]);
  const fallback = [
    { close: parsePrice(meta.postMarketPrice), timestamp: parsePrice(meta.postMarketTime), session: "afterhours" },
    { close: parsePrice(meta.preMarketPrice), timestamp: parsePrice(meta.preMarketTime), session: "premarket" },
    { close: parsePrice(quote.close?.[lastIndex]), timestamp: lastTimestamp, session: barSession(meta, lastTimestamp) },
  ].filter(({ close }) => close != null).sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))[0];
  const selected = regular.close == null ? fallback : regular;
  if (!selected) return null;

  const { close, timestamp, session } = selected;
  const asOf = timestampIso(timestamp);
  const regularPeriod = marketPeriod(meta, "regular", timestamp);
  const regularIndexes = regularPeriod ? timestamps.map((_, index) => index).filter((index) =>
    timestamps[index] >= regularPeriod.start && timestamps[index] < regularPeriod.end && timestamps[index] <= timestamp,
  ) : [];
  const highs = regularIndexes.map((index) => parsePrice(quote.high?.[index])).filter(Number.isFinite);
  const lows = regularIndexes.map((index) => parsePrice(quote.low?.[index])).filter(Number.isFinite);
  const previousClose = parsePrice(meta.previousClose) ?? parsePrice(meta.chartPreviousClose);
  const isRegular = session === "regular";
  const change = previousClose != null ? close - previousClose : isRegular ? parseNumeric(meta.regularMarketChange) : null;
  const changePercent = (isRegular ? parseNumeric(meta.regularMarketChangePercent) : null) ??
    (previousClose != null ? (change / previousClose) * 100 : null);

  return {
    symbol,
    sourceSymbol: lookupSymbol,
    source: "Yahoo Finance",
    asOf,
    session,
    regularSessionEndsAt: timestampIso(meta.currentTradingPeriod?.regular?.end),
    ...displayQuoteTime(asOf),
    open: isRegular ? parsePrice(meta.regularMarketOpen) ?? parsePrice(quote.open?.[regularIndexes[0]]) : null,
    high: isRegular ? parsePrice(meta.regularMarketDayHigh) ?? (highs.length ? Math.max(...highs) : null) : null,
    low: isRegular ? parsePrice(meta.regularMarketDayLow) ?? (lows.length ? Math.min(...lows) : null) : null,
    previousClose,
    close,
    volume: isRegular ? parseNumeric(meta.regularMarketVolume) : null,
    change,
    changePercent,
    assetType: symbol.startsWith("^") ? "index"
      : String(meta.instrumentType || "").toLowerCase() === "etf" ? "etf" : "stock",
  };
}

async function fetchQuote(symbol, refresh = false) {
  const cached = quoteCache.get(symbol);
  if (!refresh && cached && Date.now() - cached.updatedAt < QUOTE_TTL_MS) {
    return { ...cached.value, cached: true };
  }

  const providers = symbol.startsWith("^") ? [fetchYahooQuote] : [fetchYahooQuote, fetchStockAnalysisQuote, fetchStooqQuote];
  for (const fetchProvider of providers) {
    const quote = await fetchProvider(symbol).catch(() => null);
    if (!quote) continue;
    const updatedAt = Date.now();
    const value = { ...quote, fetchedAt: new Date(updatedAt).toISOString() };
    quoteCache.set(symbol, { value, updatedAt });
    return value;
  }

  const lastSuccessful = quoteCache.get(symbol);
  if (lastSuccessful) return { ...lastSuccessful.value, cached: true, stale: true };
  return { symbol, error: "시세 조회 실패" };
}

async function fetchStooqPeRatio(symbol) {
  const stooqSymbol = toStooqSymbol(symbol);
  const url = `https://stooq.com/q/g/?s=${encodeURIComponent(stooqSymbol)}`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    headers: {
      "user-agent": "Mozilla/5.0 stock-watchlist-netlify-app",
    },
  });

  if (!response.ok) return null;

  const html = await response.text();
  const peMatch =
    html.match(/C\/Z[\s\S]{0,120}?\(ttm\)[\s\S]{0,160}?<td[^>]*>\s*([^<]+?)\s*<\/td>/i) ||
    html.match(/P\/E[\s\S]{0,120}?\(ttm\)[\s\S]{0,160}?<td[^>]*>\s*([^<]+?)\s*<\/td>/i);

  return peMatch ? parseNumeric(peMatch[1]) : null;
}

async function fetchStockAnalysisPeRatio(symbol) {
  let html = "";

  for (const slug of getStockAnalysisSlugs(symbol)) {
    const url = `https://stockanalysis.com/stocks/${encodeURIComponent(slug)}/statistics/`;
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

  if (!html) return null;
  const peMatch =
    html.match(/id:"pe",title:"PE Ratio",value:"([^"]+)",hover:"([^"]+)"/i) ||
    html.match(/PE Ratio[\s\S]{0,240}?([0-9]+(?:\.[0-9]+)?)/i);

  return peMatch ? parseNumeric(peMatch[2] || peMatch[1]) : null;
}

async function fetchPeRatio(symbol) {
  const cached = peCache.get(symbol);
  const now = Date.now();

  if (cached && now - cached.updatedAt < PE_TTL_MS) return cached.value;

  try {
    const value = (await fetchStockAnalysisPeRatio(symbol)) ?? (await fetchStooqPeRatio(symbol));
    if (Number.isFinite(value)) peCache.set(symbol, { value, updatedAt: now });
    return value;
  } catch (error) {
    if (cached) return cached.value;
    throw error;
  }
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

    if (symbols.length === 0) {
      throw new Error("symbols query is required");
    }

    const entries = await Promise.all(
      symbols.map(async (symbol) => {
        try {
          const quote = await fetchQuote(symbol, refresh);
          const peRatio = quote.error || quote.assetType === "etf" || symbol.startsWith("^")
            ? null
            : await fetchPeRatio(symbol).catch(() => null);
          return [symbol, { ...quote, peRatio }];
        } catch (error) {
          return [symbol, { symbol, error: error.message || "시세 조회 실패" }];
        }
      }),
    );

    return {
      statusCode: 200,
      headers: {
        ...PUBLIC_API_HEADERS,
        "cache-control": refresh || entries.some(([, quote]) => quote.error || quote.stale)
          ? "no-store" : "public, max-age=15, must-revalidate",
      },
      body: JSON.stringify({ ok: true, quotes: Object.fromEntries(entries) }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: PUBLIC_API_HEADERS,
      body: JSON.stringify({ ok: false, error: error.message || "Quote lookup failed" }),
    };
  }
}
