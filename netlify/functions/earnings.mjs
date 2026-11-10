const NASDAQ_CALENDAR = "https://api.nasdaq.com/api/calendar/earnings";
const CALENDAR_TIMEOUT_MS = 5000;

const newYorkDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const addDays = (date, days) => {
  const next = new Date(`${date}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

const normalizeSymbol = (symbol) => String(symbol || "").trim().toUpperCase().replace(".", "-");

const earningsSession = {
  "time-pre-market": "premarket",
  "time-after-hours": "afterhours",
  "time-after-market": "afterhours",
};

async function readCalendarDay(date) {
  try {
    const response = await fetch(`${NASDAQ_CALENDAR}?date=${date}`, {
      headers: { "user-agent": "NASDAQ Watchlist swing planner" },
      signal: AbortSignal.timeout(CALENDAR_TIMEOUT_MS),
    });
    if (!response.ok) return null;

    const payload = await response.json();
    const statusCode = payload?.status?.rCode;
    if (statusCode != null && Number(statusCode) !== 200) return null;
    const rows = payload?.data?.rows;
    if (Array.isArray(rows)) return rows;
    // Nasdaq marks dates with no events, including weekends, with an explicit null rows field.
    if (rows === null && Number(statusCode) === 200 && payload.data.asOf) return [];
  } catch {
    // An unavailable date is reported in coverage without blocking the watchlist.
  }
  return null;
}

export default async (request) => {
  const url = new URL(request.url);
  const symbols = new Set((url.searchParams.get("symbols") || "").split(",").map(normalizeSymbol).filter(Boolean));
  const days = Math.max(1, Math.min(10, Math.trunc(Number(url.searchParams.get("days"))) || 7));
  const asOf = newYorkDate.format(new Date());
  const dates = Array.from({ length: days }, (_, offset) => addDays(asOf, offset));
  const results = await Promise.all(dates.map(readCalendarDay));
  const events = new Map();
  const checkedDays = [];
  const failedDays = [];

  for (const [index, rows] of results.entries()) {
    const date = dates[index];
    if (rows === null) {
      failedDays.push(date);
      continue;
    }
    checkedDays.push(date);
    for (const row of rows) {
      const symbol = normalizeSymbol(row?.symbol);
      if (!symbols.has(symbol) || events.has(symbol)) continue;
      const time = row.time || "time-not-supplied";
      events.set(symbol, { date, time, session: earningsSession[time] || "unknown", name: row.name || symbol });
    }
  }

  const status = failedDays.length === 0 ? "complete" : checkedDays.length > 0 ? "partial" : "unavailable";
  return Response.json({ ok: true, events: Object.fromEntries(events), asOf, coverage: { status, checkedDays, failedDays } }, {
    headers: {
      "access-control-allow-origin": "https://esp6662266.github.io",
      "cache-control": status === "complete" ? "public, max-age=900" : "no-store",
    },
  });
};
