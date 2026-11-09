const QUOTE_TTL_MS = 2 * 60 * 1000;
const PE_TTL_MS = 12 * 60 * 60 * 1000;
const quoteCache = new Map();
const peCache = new Map();

function normalizeStockSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "")
    .slice(0, 12);
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

async function readThroughCache(cache, key, ttlMs, fetcher) {
  const now = Date.now();
  const cached = cache.get(key);

  if (cached && now - cached.updatedAt < ttlMs) {
    return { ...cached.value, cached: true };
  }

  try {
    const value = await fetcher();
    if (value && !value.error) {
      cache.set(key, { value, updatedAt: now });
    }
    return value;
  } catch (error) {
    if (cached) return { ...cached.value, cached: true, stale: true };
    throw error;
  }
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
  const parsed = Number(clean);
  return Number.isFinite(parsed) ? parsed : null;
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
  const open = parseNumeric(row[3]);
  const close = parseNumeric(row[7]);
  const previousClose = parseNumeric(row[8]);

  if (!Number.isFinite(close)) {
    return { symbol, error: "시세 없음" };
  }

  const change = Number.isFinite(previousClose) ? close - previousClose : null;
  const changePercent =
    Number.isFinite(previousClose) && previousClose !== 0 ? (change / previousClose) * 100 : null;

  return {
    symbol,
    sourceSymbol: row[0],
    date: row[1] || "",
    time: row[2] || "",
    open,
    high: parseNumeric(row[4]),
    low: parseNumeric(row[5]),
    previousClose,
    close,
    volume: parseNumeric(row[6]),
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
  const headerClose = parseNumeric(html.match(/text-4xl[^>]*>\s*([0-9,.]+)/i)?.[1]);
  const close = chartQuote?.close ?? headerClose;
  const previousClose = parseNumeric(
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
    date: "실시간",
    time: "",
    open: null,
    high: chartQuote?.high ?? parseNumeric(rangeMatch?.[2]),
    low: chartQuote?.low ?? parseNumeric(rangeMatch?.[1]),
    previousClose,
    close,
    volume,
    change,
    changePercent,
    assetType,
  };
}

async function fetchYahooQuote(symbol) {
  const lookupSymbol = toLookupSymbol(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(lookupSymbol)}?range=1d&interval=1m&includePrePost=true`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 stock-watchlist-netlify-app",
    },
  });

  if (!response.ok) return null;

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  const meta = result?.meta || {};
  const quote = result?.indicators?.quote?.[0] || {};
  const closeRows = (quote.close || []).map(parseNumeric);
  const lastIndex = closeRows.findLastIndex((value) => Number.isFinite(value) && value > 0);
  const regularPrice = parseNumeric(meta.regularMarketPrice);
  const extendedPrice = parseNumeric(meta.postMarketPrice) ?? parseNumeric(meta.preMarketPrice);
  const close = regularPrice ?? extendedPrice ?? closeRows[lastIndex];
  const previousClose = parseNumeric(meta.previousClose) ?? parseNumeric(meta.chartPreviousClose);

  if (!Number.isFinite(close) || close <= 0) return null;

  const regularMarketTime = parseNumeric(meta.regularMarketTime);
  const date = Number.isFinite(regularMarketTime)
    ? new Date(regularMarketTime * 1000).toLocaleDateString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      })
    : "실시간";
  const time = Number.isFinite(regularMarketTime)
    ? new Date(regularMarketTime * 1000).toLocaleTimeString("ko-KR", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  const change = Number.isFinite(previousClose) ? close - previousClose : parseNumeric(meta.regularMarketChange);
  const changePercent =
    Number.isFinite(meta.regularMarketChangePercent)
      ? meta.regularMarketChangePercent
      : Number.isFinite(previousClose) && previousClose !== 0
        ? (change / previousClose) * 100
        : null;

  return {
    symbol,
    sourceSymbol: lookupSymbol,
    date,
    time,
    open: parseNumeric(meta.regularMarketOpen) ?? parseNumeric(quote.open?.[lastIndex]),
    high: parseNumeric(meta.regularMarketDayHigh) ?? Math.max(...(quote.high || []).map(parseNumeric).filter(Number.isFinite)),
    low: parseNumeric(meta.regularMarketDayLow) ?? Math.min(...(quote.low || []).map(parseNumeric).filter(Number.isFinite)),
    previousClose,
    close,
    volume: parseNumeric(meta.regularMarketVolume) ?? parseNumeric(quote.volume?.[lastIndex]),
    change,
    changePercent,
    assetType: String(meta.instrumentType || "").toLowerCase() === "etf" ? "etf" : "stock",
  };
}

async function fetchQuote(symbol, refresh = false) {
  const fetcher = async () => {
    const yahooQuote = await fetchYahooQuote(symbol);
    if (yahooQuote && Number.isFinite(yahooQuote.close)) return yahooQuote;

    const stockAnalysisQuote = await fetchStockAnalysisQuote(symbol);
    if (stockAnalysisQuote && Number.isFinite(stockAnalysisQuote.close)) return stockAnalysisQuote;

    return fetchStooqQuote(symbol);
  };
  if (!refresh) {
    return readThroughCache(quoteCache, symbol, QUOTE_TTL_MS, fetcher);
  }

  const value = await fetcher();
  if (value && !value.error) quoteCache.set(symbol, { value, updatedAt: Date.now() });
  return value;
}

async function fetchStooqPeRatio(symbol) {
  const stooqSymbol = toStooqSymbol(symbol);
  const url = `https://stooq.com/q/g/?s=${encodeURIComponent(stooqSymbol)}`;
  const response = await fetch(url, {
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
      headers: { "content-type": "application/json; charset=utf-8" },
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
          const peRatio = quote?.assetType === "etf" ? null : await fetchPeRatio(symbol);
          return [symbol, { ...quote, peRatio }];
        } catch (error) {
          return [symbol, { symbol, error: error.message || "시세 조회 실패" }];
        }
      }),
    );

    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "cache-control": refresh ? "no-store" : "public, max-age=60, stale-while-revalidate=120",
      },
      body: JSON.stringify({ ok: true, quotes: Object.fromEntries(entries) }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
      body: JSON.stringify({ ok: false, error: error.message || "Quote lookup failed" }),
    };
  }
}
