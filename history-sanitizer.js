/* Keep malformed provider candles from poisoning every chart and signal calculation. */
(() => {
  if (window.__historySanitizedFetch || typeof window.fetch !== "function") return;

  const nativeFetch = window.fetch.bind(window);
  const isHistoryRequest = (input) => {
    const url = typeof input === "string" ? input : input?.url;
    return typeof url === "string" && url.includes("/api/history");
  };

  const validCandle = (row) => {
    if (!row || !Number.isFinite(Number(row.close)) || Number(row.close) <= 0) return false;
    return ["open", "high", "low"].every(
      (key) => Number.isFinite(Number(row[key])) && Number(row[key]) > 0,
    );
  };

  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    if (!isHistoryRequest(args[0])) return response;

    try {
      const payload = await response.clone().json();
      if (!payload?.history || typeof payload.history !== "object") return response;

      const history = Object.fromEntries(
        Object.entries(payload.history).map(([symbol, rows]) => [
          symbol,
          Array.isArray(rows) ? rows.filter(validCandle) : rows,
        ]),
      );

      return new Response(JSON.stringify({ ...payload, history }), {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    } catch (_) {
      // Leave non-JSON or malformed responses untouched so the app's normal error handling runs.
      return response;
    }
  };

  window.__historySanitizedFetch = true;
})();
