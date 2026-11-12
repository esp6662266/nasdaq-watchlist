(() => {
  const quotes = new Map();
  const normalized = (symbol) => symbol?.toUpperCase().replace(/^BRK[.]B$/, "BRK-B");
  const nativeFetch = window.fetch.bind(window);
  const pagesOrigin = "https://esp6662266.github.io";
  const apiOrigin = "https://nasdaq-watchlist-0520214351.netlify.app";
  const apiPaths = new Set([
    "/api/quotes", "/api/history", "/api/earnings", "/api/fear-greed",
    "/api/market-cap", "/api/max-pain", "/api/news",
  ]);
  let requestId = 0;

  function saveQuotes(requested, payload, id) {
    const records = payload?.quotes;
    for (const symbol of requested) {
      const key = normalized(symbol);
      const prior = quotes.get(key);
      if (prior?.requestId > id) continue;
      const result = records?.[symbol] ?? records?.[key] ?? records?.[key.replace(/^BRK-B$/, "BRK.B")];
      const usable = Number.isFinite(result?.close) && result.close > 0;
      const previousTime = Date.parse(prior?.data?.asOf);
      if (usable && Number.isFinite(previousTime) && !(Date.parse(result.asOf) >= previousTime)) continue;
      quotes.set(key, {
        data: usable ? result : prior?.data,
        failed: !usable,
        receivedAt: Date.now(),
        requestId: id,
      });
    }
  }

  window.fetch = async (input, options) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    const path = url.pathname;
    if (url.origin !== location.origin || !apiPaths.has(path)) return nativeFetch(input, options);
    const method = String(options?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (method !== "GET") return nativeFetch(input, options);

    // Keep the Pages origin, where existing categories and stars are stored.
    const fromPages = location.origin === pagesOrigin;
    const fetchApi = () => {
      if (!fromPages) return nativeFetch(input, options);
      const remote = new URL(path + url.search, apiOrigin);
      const request = input instanceof Request ? new Request(remote, input) : remote.href;
      return nativeFetch(request, { ...options, credentials: "omit", mode: "cors" });
    };
    if (path !== "/api/quotes") return fetchApi();
    const requested = (url.searchParams.get("symbols") || "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
    const id = ++requestId;
    const finish = (payload) => saveQuotes(requested, payload, id);
    try {
      const response = await fetchApi();
      if (response.ok) response.clone().json().then(finish, () => finish(null));
      else finish(null);
      return response;
    } catch (error) {
      finish(null);
      throw error;
    }
  };

  window.NasdaqWatchlistData = {
    quote: (symbol) => quotes.get(normalized(symbol)),
  };
})();
