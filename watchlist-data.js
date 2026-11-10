(() => {
  const quotes = new Map();
  const histories = new Map();
  const requests = new Map();
  const normalized = (symbol) => symbol?.toUpperCase().replace(/^BRK[.]B$/, "BRK-B");
  const nativeFetch = window.fetch.bind(window);
  const pagesOrigin = "https://esp6662266.github.io";
  const apiOrigin = "https://nasdaq-watchlist-0520214351.netlify.app";
  const apiPaths = new Set([
    "/api/quotes", "/api/history", "/api/earnings", "/api/fear-greed",
    "/api/market-cap", "/api/max-pain", "/api/news",
  ]);
  let requestId = 0;
  let marketCapStatus = "loading";

  function save(path, requested, payload, id) {
    const isQuotes = path === "/api/quotes";
    const target = isQuotes ? quotes : histories;
    const records = isQuotes ? payload?.quotes : payload?.history;
    for (const symbol of requested) {
      const key = normalized(symbol);
      const prior = target.get(key);
      if (prior?.requestId > id) continue;
      const result = records?.[symbol] ?? records?.[key] ?? records?.[key.replace(/^BRK-B$/, "BRK.B")];
      const usable = isQuotes ? Number.isFinite(result?.close) && result.close > 0 : Array.isArray(result) && result.length > 0;
      const meta = payload?.meta?.[symbol] ?? payload?.meta?.[key];
      target.set(key, {
        data: usable ? result : prior?.data,
        meta: usable ? meta : prior?.meta,
        failed: !usable,
        receivedAt: Date.now(),
        requestId: id,
      });
    }
    window.dispatchEvent(new Event("nasdaq-watchlist:data"));
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
    if (path === "/api/market-cap") {
      try {
        const response = await fetchApi();
        const payload = response.ok ? await response.clone().json().catch(() => null) : null;
        marketCapStatus = payload?.ok ? (payload.data?.stale ? "stale" : "available") : "fallback";
        return response;
      } catch (error) {
        marketCapStatus = "fallback";
        throw error;
      }
    }
    if (path !== "/api/quotes" && path !== "/api/history") return fetchApi();
    const requested = (url.searchParams.get("symbols") || "").split(",").map((value) => value.trim().toUpperCase()).filter(Boolean);
    const id = ++requestId;
    requested.forEach((symbol) => requests.set(path + normalized(symbol), id));
    const finish = (payload) => {
      save(path, requested, payload, id);
      requested.forEach((symbol) => {
        const key = path + normalized(symbol);
        if (requests.get(key) === id) requests.delete(key);
      });
    };
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
    history: (symbol) => histories.get(normalized(symbol)),
    historyPending: (symbol) => requests.has("/api/history" + normalized(symbol)),
    marketCapStatus: () => marketCapStatus,
  };
})();
