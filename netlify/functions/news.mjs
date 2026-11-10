const PUBLIC_API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "https://esp6662266.github.io",
};

const NEWS_TTL_MS = 20 * 60 * 1000;
const newsCache = new Map();

const POSITIVE_WORDS = [
  "beat",
  "beats",
  "bullish",
  "upgrade",
  "raises",
  "raised",
  "growth",
  "strong",
  "surge",
  "rally",
  "record",
  "profit",
  "optimistic",
  "outperform",
  "buy",
  "winner",
  "backlog",
];

const NEGATIVE_WORDS = [
  "miss",
  "misses",
  "bearish",
  "downgrade",
  "cuts",
  "cut",
  "weak",
  "slump",
  "falls",
  "drop",
  "lawsuit",
  "probe",
  "warning",
  "risk",
  "concern",
  "sell",
  "loss",
  "decline",
];

function normalizeStockSymbol(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "")
    .slice(0, 12);
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getTagValue(item, tag) {
  return decodeEntities(item.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"))?.[1] || "");
}

function scoreNews(items) {
  const text = items.map((item) => `${item.title} ${item.description}`).join(" ").toLowerCase();
  const positive = POSITIVE_WORDS.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  const negative = NEGATIVE_WORDS.reduce((sum, word) => sum + (text.includes(word) ? 1 : 0), 0);
  const score = Math.max(-24, Math.min(24, (positive - negative) * 6));

  return {
    score,
    label: score >= 12 ? "뉴스 우호" : score <= -12 ? "뉴스 부담" : "뉴스 중립",
    positive,
    negative,
  };
}

function parseNewsXml(symbol, xml) {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .slice(0, 6)
    .map((match) => ({
      title: getTagValue(match[1], "title"),
      description: getTagValue(match[1], "description"),
      link: getTagValue(match[1], "link"),
      pubDate: getTagValue(match[1], "pubDate"),
    }))
    .filter((item) => item.title);

  return {
    symbol,
    source: "Yahoo Finance RSS",
    items,
    sentiment: scoreNews(items),
    updatedAt: new Date().toISOString(),
  };
}

async function fetchNews(symbol) {
  const now = Date.now();
  const cached = newsCache.get(symbol);
  if (cached && now - cached.updatedAt < NEWS_TTL_MS) return { ...cached.value, cached: true };

  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(symbol)}&region=US&lang=en-US`;
  const response = await fetch(url, {
    headers: {
      "user-agent": "Mozilla/5.0 stock-watchlist-netlify-app",
      accept: "application/rss+xml,text/xml",
    },
  });

  if (!response.ok) throw new Error(`News request failed for ${symbol}`);

  const xml = await response.text();
  const value = parseNewsXml(symbol, xml);
  if (value.items.length === 0) return { symbol, error: "뉴스 데이터 없음", items: [], sentiment: { score: 0, label: "뉴스 없음" } };

  newsCache.set(symbol, { value, updatedAt: now });
  return value;
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
          return [symbol, await fetchNews(symbol)];
        } catch (error) {
          return [symbol, { symbol, error: error.message || "뉴스 조회 실패", items: [], sentiment: { score: 0, label: "뉴스 없음" } }];
        }
      }),
    );

    return {
      statusCode: 200,
      headers: {
        ...PUBLIC_API_HEADERS,
        "cache-control": "public, max-age=600, stale-while-revalidate=1200",
      },
      body: JSON.stringify({ ok: true, news: Object.fromEntries(entries) }),
    };
  } catch (error) {
    return {
      statusCode: 400,
      headers: PUBLIC_API_HEADERS,
      body: JSON.stringify({ ok: false, error: error.message || "News lookup failed" }),
    };
  }
}
