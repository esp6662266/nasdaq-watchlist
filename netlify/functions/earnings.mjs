const NASDAQ_CALENDAR = "https://api.nasdaq.com/api/calendar/earnings";

const newYorkDate = (date) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).format(date);

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const normalizeSymbol = (symbol) => String(symbol || "").trim().toUpperCase().replace(".", "-");

export default async (request) => {
  const url = new URL(request.url);
  const symbols = new Set((url.searchParams.get("symbols") || "").split(",").map(normalizeSymbol).filter(Boolean));
  const days = Math.max(1, Math.min(10, Number(url.searchParams.get("days")) || 7));
  const events = {};
  const start = new Date();

  await Promise.all(Array.from({ length: days }, async (_, offset) => {
    const date = newYorkDate(addDays(start, offset));
    try {
      const response = await fetch(`${NASDAQ_CALENDAR}?date=${date}`, {
        headers: { "user-agent": "NASDAQ Watchlist swing planner" },
      });
      if (!response.ok) return;
      const payload = await response.json();
      for (const row of payload?.data?.rows || []) {
        const symbol = normalizeSymbol(row.symbol);
        if (!symbols.has(symbol)) continue;
        events[symbol] = {
          date,
          time: row.time || "time-not-supplied",
          name: row.name || symbol,
        };
      }
    } catch (_) {
      // An unavailable calendar should not block the watchlist itself.
    }
  }));

  return Response.json({ ok: true, events, asOf: newYorkDate(start) }, {
    headers: { "cache-control": "public, max-age=900" },
  });
};
