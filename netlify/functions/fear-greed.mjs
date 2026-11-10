const PUBLIC_API_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "https://esp6662266.github.io",
};

const API_URL = "https://production.dataviz.cnn.io/index/fearandgreed/graphdata";
const CACHE_TTL_MS = 60 * 60 * 1000;
let cache = null;

const INDICATOR_NAMES = {
  market_momentum_sp500: "Market Momentum",
  stock_price_strength: "Stock Price Strength",
  stock_price_breadth: "Stock Price Breadth",
  put_call_options: "Put/Call Options",
  market_volatility_vix: "Market Volatility",
  junk_bond_demand: "Junk Bond Demand",
  safe_haven_demand: "Safe Haven Demand",
};

function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function normalizeRating(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, " ");
}

function formatPoint(point) {
  if (!point || !Number.isFinite(Number(point.x))) return null;
  return {
    date: new Date(Number(point.x)).toISOString().slice(0, 10),
    score: round(point.y),
    rating: normalizeRating(point.rating),
  };
}

function parsePayload(payload) {
  const current = payload?.fear_and_greed;
  if (!current || !Number.isFinite(Number(current.score))) {
    throw new Error("CNN Fear & Greed data is unavailable");
  }

  const indicators = Object.entries(INDICATOR_NAMES)
    .map(([key, name]) => {
      const indicator = payload[key];
      if (!indicator || !Number.isFinite(Number(indicator.score))) return null;
      return {
        key,
        name,
        score: round(indicator.score),
        rating: normalizeRating(indicator.rating),
      };
    })
    .filter(Boolean);

  return {
    score: round(current.score),
    rating: normalizeRating(current.rating),
    timestamp: current.timestamp || null,
    previousClose: round(current.previous_close),
    history: {
      "1w": round(current.previous_1_week),
      "1m": round(current.previous_1_month),
      "1y": round(current.previous_1_year),
    },
    indicators,
    recent: (payload?.fear_and_greed_historical?.data || []).slice(-30).map(formatPoint).filter(Boolean),
  };
}

async function fetchFearGreed() {
  const response = await fetch(API_URL, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      referer: "https://edition.cnn.com/",
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`CNN request failed (${response.status})`);
  }

  return parsePayload(await response.json());
}

export async function handler(event) {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: PUBLIC_API_HEADERS,
      body: JSON.stringify({ ok: false, error: "Method not allowed" }),
    };
  }

  const now = Date.now();
  if (cache && now - cache.updatedAt < CACHE_TTL_MS) {
    return {
      statusCode: 200,
      headers: {
        ...PUBLIC_API_HEADERS,
        "cache-control": "public, max-age=900, stale-while-revalidate=3600",
      },
      body: JSON.stringify({ ok: true, data: { ...cache.value, cached: true } }),
    };
  }

  try {
    const value = await fetchFearGreed();
    cache = { value, updatedAt: now };
    return {
      statusCode: 200,
      headers: {
        ...PUBLIC_API_HEADERS,
        "cache-control": "public, max-age=900, stale-while-revalidate=3600",
      },
      body: JSON.stringify({ ok: true, data: value }),
    };
  } catch (error) {
    if (cache) {
      return {
        statusCode: 200,
        headers: PUBLIC_API_HEADERS,
        body: JSON.stringify({ ok: true, data: { ...cache.value, cached: true, stale: true } }),
      };
    }

    return {
      statusCode: 502,
      headers: PUBLIC_API_HEADERS,
      body: JSON.stringify({ ok: false, error: error.message || "Fear & Greed lookup failed" }),
    };
  }
}
