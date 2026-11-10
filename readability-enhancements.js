/* Start with market-cap order, then remember the board controls the user changes. */
(() => {
  const keyFor = (menu, index) => `nasdaq-watchlist-control:${menu.getAttribute("aria-label") || menu.name || index}`;
  const applyPreferences = () => {
    const menus = [...document.querySelectorAll('select:not([aria-label="카테고리 바로 선택"])')];
    if (!menus.length) return false;
    menus.forEach((menu, index) => {
      const key = keyFor(menu, index);
      const stored = localStorage.getItem(key);
      const isSort = [...menu.options].some((option) => option.value === "marketCap");
      const wanted = stored && [...menu.options].some((option) => option.value === stored)
        ? stored
        : isSort ? "marketCap" : null;
      if (wanted && menu.value !== wanted) {
        menu.value = wanted;
        menu.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (!menu.dataset.preferenceBound) {
        menu.dataset.preferenceBound = "true";
        menu.addEventListener("change", () => localStorage.setItem(key, menu.value));
      }
    });
    return true;
  };

  if (!applyPreferences()) setTimeout(applyPreferences, 1000);
})();

/* Keep the market snapshot compact: Signal Board and fear/greed share one row. */
(() => {
  const compactMarketHeader = () => {
    const board = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("SIGNAL BOARD ·"));
    const fearImage = [...document.querySelectorAll("img")].find((image) => image.alt.includes("공포 탐욕"));
    if (!board || !fearImage) return false;
    const boardCard = board.parentElement;
    const fearCard = fearImage.closest("div[class]")?.parentElement;
    if (!boardCard || !fearCard || boardCard === fearCard) return false;
    let row = document.querySelector("[data-market-summary-row]");
    if (!row) {
      row = document.createElement("section");
      row.dataset.marketSummaryRow = "";
      row.style.cssText = "display:grid;grid-template-columns:minmax(0,1.45fr) minmax(250px,.85fr);gap:12px;align-items:stretch;margin:0 auto 12px;max-width:100%;padding:0 12px";
      boardCard.before(row);
    }
    if (!row.contains(boardCard)) row.append(boardCard);
    if (!row.contains(fearCard)) row.append(fearCard);
    boardCard.style.minHeight = "0";
    fearCard.style.minHeight = "0";
    return true;
  };
  setTimeout(compactMarketHeader, 800);
  setInterval(compactMarketHeader, 2500);
})();

/* Keep the Signal Board focused on M7 plus the three market proxies. */
(() => {
  const rotation = [
    ["AAPL", "Apple"], ["MSFT", "Microsoft"], ["GOOGL", "Alphabet"],
    ["AMZN", "Amazon"], ["NVDA", "NVIDIA"], ["META", "Meta"],
    ["TSLA", "Tesla"], ["QQQ", "Nasdaq 100"], ["SPY", "S&P 500"],
    ["DIA", "Dow Jones"]
  ];
  const domains = {
    AAPL: "apple.com", MSFT: "microsoft.com", GOOGL: "abc.xyz", AMZN: "amazon.com",
    NVDA: "nvidia.com", META: "meta.com", TSLA: "tesla.com", QQQ: "invesco.com",
    SPY: "ssga.com", DIA: "ssga.com"
  };
  let cursor = 0;
  let quotes = {};

  const formatPrice = (value) => value == null ? "데이터 대기" : `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const render = () => {
    const board = [...document.querySelectorAll("button")].find((button) => button.innerText.includes("SIGNAL BOARD ·"));
    if (!board) return;
    const [symbol, name] = rotation[cursor];
    const quote = quotes[symbol];
    const change = quote?.changePercent;
    const direction = change == null ? "데이터 대기" : `${change >= 0 ? "+" : ""}${Number(change).toFixed(2)}%`;
    const color = change == null ? "#a1a1aa" : change >= 0 ? "#93c5fd" : "#fda4af";
    const iconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domains[symbol])}&sz=128`;
    board.innerHTML = `<div class="signal-flip-content" style="display:flex;width:100%;align-items:center;gap:12px"><div style="min-width:0;text-align:left"><div style="font-size:11px;font-weight:900;letter-spacing:.16em;color:#bfdbfe">SIGNAL BOARD · M7 & MARKET</div><div style="display:flex;align-items:center;gap:10px;margin-top:7px;flex-wrap:wrap"><span style="position:relative;display:inline-flex;width:30px;height:30px;align-items:center;justify-content:center;overflow:hidden;border-radius:50%;background:#fff;color:#18181b;font-size:10px;font-weight:900"><span data-signal-fallback>${symbol.slice(0,2)}</span><img data-signal-logo src="${iconUrl}" alt="${name} logo" style="position:absolute;inset:0;width:100%;height:100%;object-fit:contain;padding:3px;background:#fff"></span><strong style="font-size:24px;color:#fff">${symbol}</strong><span style="font-size:13px;font-weight:700;color:#d4d4d8">${name}</span><span style="font-size:14px;font-weight:900;color:#fff">${formatPrice(quote?.close)}</span><span style="font-size:14px;font-weight:900;color:${color}">${direction}</span></div></div><div style="margin-left:auto;text-align:right;font-size:11px;font-weight:800;color:#a1a1aa">${cursor + 1}/10<br>자동 순환</div></div>`;
    const icon = board.querySelector("[data-signal-logo]");
    if (icon) icon.addEventListener("error", () => { icon.remove(); }, { once: true });
  };
  const refresh = async () => {
    try {
      const symbols = rotation.map(([symbol]) => symbol).join(",");
      const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(symbols)}`);
      const payload = await response.json();
      if (payload.ok) quotes = payload.quotes || {};
    } catch (_) {}
    render();
  };
  refresh();
  setInterval(() => { cursor = (cursor + 1) % rotation.length; render(); }, 5000);
  setInterval(refresh, 60000);
})();

/* Share one completed-candle swing model across the board, details, and alerts. */
(() => {
  const data = window.NasdaqWatchlistData;
  const swing = window.NasdaqSwingPlan;
  const modelBySymbol = new Map();
  const earningsBySymbol = new Map();
  const pendingEarnings = new Set();
  const notified = new Set();
  const historyMaxAge = 15 * 60 * 1000;
  const earningsMaxAge = 15 * 60 * 1000;
  const marketDate = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", dateStyle: "short" });
  const marketClock = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const koreaTime = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const priceText = (value) => Number.isFinite(value)
    ? `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—";
  const providerSymbol = (symbol) => symbol.replace(/^BRK[.]B$/, "BRK-B");
  const cardSelector = 'button.market-compact-card, button.market-action-card, button[class*="grid-cols-[42px_"]';
  let refreshTimer;
  let summaryOpen = false;

  function dateOf(value) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? marketDate.format(timestamp) : "";
  }

  function getSymbol(card) {
    return window.NasdaqWatchlistHome.tickerForCard(card);
  }

  function marketSessionAt(now, quote) {
    const date = marketDate.format(now);
    const parts = Object.fromEntries(marketClock.formatToParts(now).map(({ type, value }) => [type, value]));
    const minute = Number(parts.hour) * 60 + Number(parts.minute);
    const knownEnd = dateOf(quote?.regularSessionEndsAt) === date;
    const complete = knownEnd ? now >= Date.parse(quote.regularSessionEndsAt) : minute >= 960;
    const weekday = parts.weekday !== "Sat" && parts.weekday !== "Sun";
    return { date, complete, open: weekday && minute >= 570 && !complete, knownEnd };
  }

  function quoteState(symbol, now = Date.now()) {
    const record = data.quote(symbol);
    const quote = record?.data;
    const stamp = Date.parse(quote?.asOf);
    const fetched = Date.parse(quote?.fetchedAt);
    const basis = Number.isFinite(stamp) ? `${koreaTime.format(stamp)} KST` : "시세 시각 미확인";
    const session = { regular: "정규장", premarket: "장전", afterhours: "장후", close: "종가" }[quote?.session] || "";
    const provenance = [quote?.source, session, basis].filter(Boolean).join(" · ");
    if (record?.failed) return { quote, usable: false, label: quote ? "조회 실패 · 마지막 시세" : "시세 조회 실패", provenance };
    if (!quote) return { usable: false, label: "시세 확인 중", provenance: "" };
    if (!Number.isFinite(stamp) || !Number.isFinite(fetched)) {
      return { quote, usable: false, label: "시세 시각 미확인", provenance };
    }
    const market = marketSessionAt(now, quote);
    const lastTradeDate = marketDate.format(stamp);
    const delayed = market.open && now - stamp > 25 * 60 * 1000;
    const missedClose = market.knownEnd && market.complete && lastTradeDate !== market.date;
    if (quote.stale || delayed || missedClose || now - fetched > 30 * 60 * 1000 ||
        now - stamp > 4 * 24 * 60 * 60 * 1000 || stamp - now > 2 * 60 * 1000) {
      return { quote, usable: false, label: "이전 시세", provenance };
    }
    return { quote, usable: true, label: "시세 확인", provenance };
  }

  function earningsState(symbol, now) {
    const record = earningsBySymbol.get(symbol);
    if (!record) return { label: "실적 일정 확인 중", verified: false };
    const event = record.event;
    if (record.asOf !== marketDate.format(now) || now - record.receivedAt > earningsMaxAge) {
      return { label: "실적 일정 재확인 중", verified: false };
    }
    const verified = record.status === "complete";
    if (!event?.date) return { label: verified ? "실적 · 7일 내 일정 없음" : "실적 일정 미확인", verified, soon: verified ? false : undefined };
    const days = Math.round((Date.parse(event.date) - Date.parse(record.asOf)) / 86400000);
    if (!Number.isFinite(days) || days < 0) return { label: "실적 일정 미확인", verified: false };
    const session = { premarket: "장전", afterhours: "장후" }[event.session] || "시간 미정";
    return { label: `실적 D-${days} · ${session}`, date: event.date, verified, soon: days <= 2 };
  }

  function getModel(symbol, now) {
    const status = quoteState(symbol, now);
    const quote = status.quote;
    const history = data.history(symbol);
    const rows = history?.data || [];
    const latestDate = rows.at(-1)?.time;
    const quoteDate = dateOf(quote?.asOf);
    const marketSession = marketSessionAt(now, quote);
    const closeExpected = quoteDate && (quoteDate !== marketSession.date || marketSession.complete || quote?.session === "afterhours" || quote?.session === "close");
    const historyUsable = Boolean(latestDate && !history.failed && history.meta?.status === "available" && !history.meta.stale &&
      now - history.receivedAt < 30 * 60 * 1000 && (!closeExpected || latestDate >= quoteDate));
    const earnings = earningsState(symbol, now);
    const model = swing.analyze({ symbol, rows, historyUsable, quoteUsable: status.usable, earnings, now: new Date(now), marketSession });
    if (!status.usable || !historyUsable || !earnings.verified) {
      model.comment = { ...model.comment, verdict: "판정 보류", tier: "hold" };
    }
    const nextPrice = status.usable && historyUsable
      ? (model.comment.tier === "entry" ? model.plan?.targetValue : model.plan?.entryValue) : null;
    return {
      ...model, historyUsable, quoteUsable: status.usable, earnings,
      name: quote?.name || quote?.longName, dataState: status.label,
      provenance: status.provenance, price: quote?.close ?? null, changePercent: quote?.changePercent ?? null,
      verdict: model.comment.verdict, nextPrice: nextPrice ?? null,
    };
  }

  async function fetchEarnings(symbols) {
    if (!symbols.length) return;
    symbols.forEach((symbol) => pendingEarnings.add(symbol));
    try {
      const response = await fetch(`/api/earnings?days=7&symbols=${encodeURIComponent(symbols.map(providerSymbol).join(","))}`);
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error("Calendar unavailable");
      for (const symbol of symbols) {
        earningsBySymbol.set(symbol, {
          asOf: payload.asOf,
          receivedAt: Date.now(),
          status: payload.coverage?.status,
          event: payload.events?.[providerSymbol(symbol)] ?? payload.events?.[symbol],
        });
      }
    } catch {
      symbols.forEach((symbol) => earningsBySymbol.set(symbol, {
        asOf: marketDate.format(Date.now()), receivedAt: Date.now(), status: "unavailable",
      }));
    } finally {
      symbols.forEach((symbol) => pendingEarnings.delete(symbol));
      queueRender();
    }
  }

  function refreshInputs(symbols, now, force) {
    const date = marketDate.format(now);
    const history = symbols.filter((symbol) => {
      const entry = data.history(symbol);
      const market = marketSessionAt(now, data.quote(symbol)?.data);
      const sessionJustEnded = market.knownEnd && market.complete && entry?.data?.at(-1)?.time !== date;
      const due = !entry || now - entry.receivedAt > (entry.failed || sessionJustEnded ? 60_000 : historyMaxAge);
      return (force || due) && !data.historyPending(symbol);
    });
    for (let index = 0; index < history.length; index += 25) {
      const batch = history.slice(index, index + 25).map(providerSymbol);
      const query = new URLSearchParams({ symbols: batch.join(",") });
      if (force || history.slice(index, index + 25).some((symbol) => {
        const market = marketSessionAt(now, data.quote(symbol)?.data);
        return market.knownEnd && market.complete && data.history(symbol)?.data?.at(-1)?.time !== date;
      })) query.set("refresh", "true");
      fetch(`/api/history?${query}`).catch(() => {});
    }
    const earnings = symbols.filter((symbol) => {
      const record = earningsBySymbol.get(symbol);
      const retry = record?.status === "complete" ? earningsMaxAge : 2 * 60 * 1000;
      return !pendingEarnings.has(symbol) && (force || !record || record.asOf !== date || now - record.receivedAt >= retry);
    });
    if (earnings.length) void fetchEarnings(earnings);
  }

  function markLegacy(element) {
    if (element) element.dataset.legacyWatchlistSignal = "";
  }

  function renderCard(card, symbol, model) {
    card.dataset.watchlistSymbol = symbol;
    card.dataset.swingTier = model.comment.tier;
    card.setAttribute("aria-label", [symbol, priceText(model.price), model.verdict, "상세 열기"].join(" · "));
    if (card.classList.contains("market-compact-card")) {
      markLegacy(card.firstElementChild?.firstElementChild?.children[1]);
      markLegacy(card.querySelector(":scope > .mt-2 > .mt-1.flex.justify-between")?.parentElement);
      markLegacy(card.querySelector(":scope > div .overflow-hidden > div:first-child > span"));
    } else if (card.classList.contains("market-action-card")) {
      const header = card.children[1];
      markLegacy(header?.firstElementChild?.firstElementChild?.children[1]);
      markLegacy(header?.lastElementChild);
      markLegacy(card.querySelector(":scope > .mt-3.flex.flex-wrap"));
    } else {
      markLegacy(card.children[1]?.querySelector("span.md\\:hidden"));
      markLegacy(card.children[5]);
    }
    let status = card.querySelector(":scope > [data-swing-card-status]");
    if (!status) {
      status = document.createElement("span");
      status.dataset.swingCardStatus = "";
      card.append(status);
    }
    const label = model.quoteUsable ? model.verdict : `${model.verdict} · ${model.dataState}`;
    if (status.textContent !== label) status.textContent = label;
  }

  function addPlanPanel(host, symbol, model) {
    let panel = host.querySelector(":scope > [data-unified-swing]");
    if (!panel) {
      panel = document.createElement("section");
      panel.dataset.unifiedSwing = "";
      host.prepend(panel);
    }
    const signature = JSON.stringify([symbol, model.verdict, model.provenance, model.dataState, model.earnings.label, model.comment.reasons, model.plan?.detail, model.plan?.ratio, model.plan?.targetValue, model.historyUsable]);
    if (panel.dataset.signature === signature) return;
    panel.dataset.signature = signature;
    panel.dataset.tier = model.comment.tier;
    const expanded = panel.querySelector("details")?.open ?? false;
    const headline = document.createElement("strong");
    headline.className = "unified-swing-verdict";
    headline.textContent = model.verdict;
    const source = document.createElement("p");
    source.className = "unified-swing-source";
    source.textContent = [model.dataState, model.provenance].filter(Boolean).join(" · ");
    const plan = model.historyUsable ? model.plan : null;
    const levels = document.createElement("dl");
    for (const [label, value] of [["진입 기준", plan?.entry], ["무효화 기준", plan?.stop], ["1차 목표", plan?.target], ["계획 손익비", plan?.ratio]]) {
      const cell = document.createElement("div");
      const term = document.createElement("dt");
      const valueNode = document.createElement("dd");
      term.textContent = label;
      valueNode.textContent = value || "—";
      cell.append(term, valueNode);
      levels.append(cell);
    }
    const details = document.createElement("details");
    details.open = expanded;
    const summary = document.createElement("summary");
    summary.textContent = "판정 근거";
    const reasonList = document.createElement("ul");
    for (const reason of [model.earnings.label, ...(model.comment.reasons || []), plan?.detail].filter(Boolean)) {
      const item = document.createElement("li");
      item.textContent = reason;
      reasonList.append(item);
    }
    details.append(summary, reasonList);
    panel.replaceChildren(headline, source, levels, details);
  }

  function findLabel(root, label) {
    return [...root.querySelectorAll("div")].find((element) =>
      !element.children.length && element.textContent.trim().toLowerCase() === label);
  }

  function renderDetails(now) {
    for (const dialog of document.querySelectorAll('[role="dialog"][aria-label$=" 상세 보드"]')) {
      const symbol = dialog.getAttribute("aria-label").replace(/ 상세 보드$/, "");
      const model = modelBySymbol.get(symbol) || getModel(symbol, now);
      const body = dialog.children[1];
      if (!body) continue;
      const header = findLabel(body, "single stock board")?.nextElementSibling;
      header?.querySelectorAll(":scope > span.rounded-full:not(.bg-blue-50)").forEach(markLegacy);
      const legacySwing = findLabel(body, "swing entry");
      markLegacy(legacySwing?.parentElement?.parentElement?.parentElement);
      const price = findLabel(body, "현재가");
      markLegacy(price?.parentElement?.nextElementSibling);
      if (price?.parentElement?.parentElement?.parentElement) {
        addPlanPanel(price.parentElement.parentElement.parentElement, symbol, model);
      }
    }
    const chart = document.querySelector('.chart-stage [aria-label$=" 볼린저밴드 차트"]');
    const stage = chart?.closest(".chart-stage");
    if (!stage) return;
    const symbol = chart.getAttribute("aria-label").replace(/ 볼린저밴드 차트$/, "");
    const model = modelBySymbol.get(symbol) || getModel(symbol, now);
    const decision = findLabel(stage, "종합판정");
    markLegacy(decision?.parentElement?.parentElement?.parentElement);
    const legacySwing = findLabel(stage, "swing entry");
    markLegacy(legacySwing?.parentElement?.parentElement?.parentElement);
    const header = findLabel(stage, "bollinger + max pain");
    header?.nextElementSibling?.querySelectorAll(":scope > span.rounded-full").forEach(markLegacy);
    if (header) addPlanPanel(header.parentElement.parentElement.parentElement, symbol, model);
  }

  function renderMarketState(models) {
    const label = findLabel(document, "market mood bar");
    const panel = label?.parentElement?.parentElement;
    if (!panel) return;
    [...panel.children].slice(0, 4).forEach((child, index) => { if (index && !child.hasAttribute("data-swing-market-state")) markLegacy(child); });
    markLegacy(panel.nextElementSibling);
    let value = panel.querySelector("[data-swing-market-state]");
    if (!value) {
      value = document.createElement("p");
      value.dataset.swingMarketState = "";
      panel.append(value);
    }
    const usable = models.filter((model) => model.quoteUsable);
    const entry = usable.filter((model) => model.comment.tier === "entry").length;
    const waiting = usable.filter((model) => model.comment.tier === "waiting").length;
    const watch = usable.filter((model) => model.comment.tier === "watch").length;
    const hold = models.length - entry - waiting - watch;
    const nextText = !usable.length
      ? "시세 확인 전 · 시장 판정 보류"
      : `조건 충족 ${entry} · 진입 대기 ${waiting} · 관찰 ${watch} · 판정 보류 ${hold}`;
    if (value.textContent !== nextText) value.textContent = nextText;
  }

  function notifyAlerts(alerts) {
    if (!("Notification" in window) || Notification.permission !== "granted" ||
        localStorage.getItem("nasdaq-watchlist:swing-notifications") !== "enabled") return;
    for (const alert of alerts) {
      if (notified.has(alert.key)) continue;
      notified.add(alert.key);
      try { new Notification(`${alert.symbol} ${alert.type}`, { body: alert.detail, tag: alert.key }); } catch {}
    }
  }

  function renderAlerts(cards, alerts) {
    const target = cards[0]?.parentElement;
    if (!target) return;
    let summary = document.querySelector("[data-unified-swing-alerts]");
    if (!summary) {
      summary = document.createElement("details");
      summary.dataset.unifiedSwingAlerts = "";
      summary.open = summaryOpen;
      const label = document.createElement("summary");
      label.textContent = "스윙 조건 알림";
      const list = document.createElement("ul");
      const enable = document.createElement("button");
      enable.type = "button";
      enable.textContent = "브라우저 알림 켜기";
      enable.addEventListener("click", async () => {
        if (!("Notification" in window)) {
          enable.textContent = "이 브라우저는 알림 미지원";
          return;
        }
        if (await Notification.requestPermission() === "granted") {
          localStorage.setItem("nasdaq-watchlist:swing-notifications", "enabled");
          queueRender();
        } else {
          enable.textContent = "브라우저 알림 미허용";
        }
      });
      summary.addEventListener("toggle", () => { summaryOpen = summary.open; });
      summary.append(label, list, enable);
    }
    if (summary.nextElementSibling !== target) target.before(summary);
    const list = summary.querySelector("ul");
    const texts = alerts.length ? alerts.map((alert) => `${alert.symbol} · ${alert.type} · ${alert.detail}`)
      : ["확인된 새 조건이 없습니다."];
    const signature = texts.join("\n");
    if (list.dataset.signature !== signature) {
      list.dataset.signature = signature;
      list.replaceChildren(...texts.map((text) => {
        const item = document.createElement("li");
        item.textContent = text;
        return item;
      }));
    }
    if ("Notification" in window && Notification.permission === "granted" &&
        localStorage.getItem("nasdaq-watchlist:swing-notifications") === "enabled") {
      summary.querySelector("button").textContent = "브라우저 알림 사용 중";
    }
    notifyAlerts(alerts);
  }

  function render(force = false) {
    const cards = [...document.querySelectorAll(cardSelector)];
    const now = Date.now();
    const cardSymbols = new Set(cards.map(getSymbol).filter(Boolean));
    const symbols = new Set(cardSymbols);
    for (const dialog of document.querySelectorAll('[role="dialog"][aria-label$=" 상세 보드"]')) {
      symbols.add(dialog.getAttribute("aria-label").replace(/ 상세 보드$/, ""));
    }
    const chart = document.querySelector('.chart-stage [aria-label$=" 볼린저밴드 차트"]');
    if (chart) symbols.add(chart.getAttribute("aria-label").replace(/ 볼린저밴드 차트$/, ""));
    for (const symbol of symbols) modelBySymbol.set(symbol, getModel(symbol, now));
    for (const card of cards) {
      const symbol = getSymbol(card);
      if (symbol) renderCard(card, symbol, modelBySymbol.get(symbol));
    }
    const models = [...cardSymbols].map((symbol) => modelBySymbol.get(symbol));
    renderMarketState(models);
    renderDetails(now);
    renderAlerts(cards, models.flatMap((model) => model.alerts).slice(0, 8));
    window.NasdaqWatchlistHome?.render(modelBySymbol);
    refreshInputs([...symbols], now, force);
  }

  function queueRender() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      render();
    }, 120);
  }

  window.NasdaqWatchlistView = { quoteState, model: (symbol) => modelBySymbol.get(symbol) };
  window.addEventListener("nasdaq-watchlist:data", queueRender);
  document.addEventListener("click", (event) => {
    if (event.target.closest("button")?.textContent.trim() === "새로고침") {
      setTimeout(() => render(true), 200);
    }
  });
  const root = document.getElementById("root");
  new MutationObserver((changes) => {
    if (changes.some(({ addedNodes, removedNodes }) => [...addedNodes, ...removedNodes].some((node) =>
      node instanceof Element && (node.matches(`${cardSelector}, [role="dialog"], .chart-stage`) ||
        node.querySelector(`${cardSelector}, [role="dialog"], .chart-stage`))))) queueRender();
  }).observe(root, { childList: true, subtree: true });
  setInterval(queueRender, 5000);
  queueRender();
})();

/* Keep the useful controls, but remove the decorative title block from the header. */
(() => {
  const simplifyHeader = () => {
    const title = [...document.querySelectorAll("h1")].find((element) => element.textContent.trim() === "Bollinger Timing");
    if (title?.parentElement) title.parentElement.style.display = "none";
  };
  setTimeout(simplifyHeader, 900);
  setInterval(simplifyHeader, 30000);
})();

/* Dashboard reading aids: clear signal hierarchy, market freshness, a compact
   market-tape mode, and a one-glance summary above the selected detail chart. */
(() => {
  const setupMarketTape = () => {
    const tape = document.querySelector("[data-market-tape]");
    if (!tape) return;
    const shell = tape.firstElementChild;
    const viewport = tape.querySelector("[data-market-tape-viewport]");
    if (!shell || !viewport) return;

    let freshness = tape.querySelector("[data-market-freshness]");
    if (!freshness) {
      freshness = document.createElement("span");
      freshness.dataset.marketFreshness = "";
      freshness.style.cssText = "flex:0 0 auto;color:#64748b;font-size:10px;font-weight:850;white-space:nowrap";
      shell.append(freshness);
    }
    const status = window.NasdaqWatchlistView.quoteState("QQQ");
    freshness.textContent = status.usable
      ? `QQQ 기준 · ${status.provenance}`
      : `QQQ · ${status.label}`;
    freshness.title = status.provenance;

    let toggle = tape.querySelector("[data-market-toggle]");
    if (!toggle) {
      toggle = document.createElement("button");
      toggle.type = "button";
      toggle.dataset.marketToggle = "";
      toggle.style.cssText = "flex:0 0 auto;margin-right:7px;border:1px solid #cbd5e1;border-radius:8px;background:#fff;padding:5px 7px;color:#475569;font-size:10px;font-weight:900;cursor:pointer";
      toggle.addEventListener("click", () => {
        const collapsed = tape.dataset.marketCollapsed !== "true";
        tape.dataset.marketCollapsed = String(collapsed);
        viewport.style.display = collapsed ? "none" : "block";
        toggle.textContent = collapsed ? "지표 보기" : "접기";
        toggle.setAttribute("aria-expanded", String(!collapsed));
        localStorage.setItem("nasdaq-market-tape-collapsed", String(collapsed));
      });
      shell.append(toggle);
    }
    const collapsed = localStorage.getItem("nasdaq-market-tape-collapsed") === "true";
    tape.dataset.marketCollapsed = String(collapsed);
    viewport.style.display = collapsed ? "none" : "block";
    toggle.textContent = collapsed ? "지표 보기" : "접기";
    toggle.setAttribute("aria-expanded", String(!collapsed));
  };

  const addSvg = (tag, attributes, text) => {
    const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
    if (text) element.textContent = text;
    return element;
  };

  const setupChartGuides = () => {
    const chart = document.querySelector('[aria-label$="볼린저밴드 차트"]');
    if (!chart) return;

    const labels = { "1M": "20일", "3M": "60일", "6M": "120일", "1Y": "1년" };
    chart.closest(".chart-stage")?.querySelectorAll("button").forEach((button) => {
      const original = button.dataset.rangeOriginal || button.textContent.trim();
      if (!labels[original]) return;
      button.dataset.rangeOriginal = original;
      button.textContent = labels[original];
      button.setAttribute("aria-label", `차트 기간 ${labels[original]}`);
    });

    chart.querySelector("[data-entry-guides]")?.remove();
    const symbol = chart.getAttribute("aria-label")?.replace(/ 볼린저밴드 차트$/, "");
    const model = window.NasdaqWatchlistView.model(symbol);
    const plan = model?.historyUsable ? model.plan : null;
    const levels = [
      { key: "진입", color: "#2563eb", value: plan?.entryValue },
      { key: "목표", color: "#7c3aed", value: plan?.targetValue },
      { key: "무효화", color: "#e11d48", value: plan?.stopValue },
    ].filter((level) => Number.isFinite(level.value));
    const axis = [...chart.querySelectorAll("g")].map((group) => {
      const line = group.querySelector("line");
      const text = group.querySelector("text");
      return { price: Number(text?.textContent), y: Number(line?.getAttribute("y1")) };
    }).filter((point) => Number.isFinite(point.price) && Number.isFinite(point.y));
    if (levels.length === 0 || axis.length < 2) return;

    const highest = axis.reduce((best, point) => point.price > best.price ? point : best);
    const lowest = axis.reduce((best, point) => point.price < best.price ? point : best);
    if (highest.price === lowest.price) return;
    const group = addSvg("g", { "data-entry-guides": "", "pointer-events": "none" });
    levels.forEach((level) => {
      const y = highest.y + ((highest.price - level.value) / (highest.price - lowest.price)) * (lowest.y - highest.y);
      if (y < 30 || y > 430) return;
      group.append(
        addSvg("line", { x1: 62, x2: 876, y1: y, y2: y, stroke: level.color, "stroke-width": 1.4, "stroke-dasharray": "7 6", opacity: 0.86 }),
        addSvg("rect", { x: 69, y: y - 13, width: 92, height: 21, rx: 10.5, fill: level.color, opacity: 0.94 }),
        addSvg("text", { x: 79, y: y + 1.5, fill: "#fff", "font-size": 10, "font-weight": 900 }, `${level.key} $${level.value.toFixed(2)}`),
      );
    });
    chart.append(group);
  };

  const enhanceDashboard = () => {
    setupMarketTape();
    setupChartGuides();
  };
  setTimeout(enhanceDashboard, 2200);
  setTimeout(enhanceDashboard, 6000);
  setInterval(enhanceDashboard, 5000);
})();

/* A compact market tape keeps the four key market references within reach. */
(() => {
  const items = [
    { label: "S&P 500", symbols: ["^GSPC", "SPY"], digits: 2 },
    { label: "Nasdaq 100", symbols: ["^NDX", "QQQ"], digits: 2 },
    { label: "Dow Jones", symbols: ["^DJI", "DIA"], digits: 2 },
    { label: "Philadelphia Semiconductor", symbols: ["^SOX", "SOXX"], digits: 2 }
  ];
  const allSymbols = [...new Set(items.flatMap((item) => item.symbols))];
  let quotes = {};
  let lastFrame = 0;
  let paused = false;
  let resumeTimer;

  const quoteFor = (item) => item.symbols.map((symbol) => quotes[symbol]).find(Boolean);
  const formatValue = (item, value) => {
    if (!Number.isFinite(value)) return "데이터 대기";
    const text = Number(value).toLocaleString("en-US", { minimumFractionDigits: item.digits, maximumFractionDigits: item.digits });
    return text;
  };
  const movement = (change) => {
    if (!Number.isFinite(change)) return { text: "—", color: "#64748b", background: "#f1f5f9" };
    const value = Number(change);
    return value > 0.03
      ? { text: `▲ +${value.toFixed(2)}%`, color: "#047857", background: "#d1fae5" }
      : value < -0.03
        ? { text: `▼ ${value.toFixed(2)}%`, color: "#be123c", background: "#ffe4e6" }
        : { text: `■ ${value >= 0 ? "+" : ""}${value.toFixed(2)}%`, color: "#475569", background: "#e2e8f0" };
  };

  const render = () => {
    const tape = document.querySelector("[data-market-tape]");
    if (!tape) return;
    const tracks = [...tape.querySelectorAll("[data-market-tape-track]")];
    tracks.forEach((track) => {
      track.replaceChildren(...items.map((item) => {
        const quote = quoteFor(item);
        const state = movement(quote?.changePercent);
        const cell = document.createElement("div");
        cell.style.cssText = "display:flex;min-width:188px;align-items:center;justify-content:space-between;gap:10px;border-right:1px solid #e2e8f0;padding:0 13px;color:#0f172a";
        const label = document.createElement("span");
        label.textContent = item.label;
        label.style.cssText = "min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-weight:950;letter-spacing:.01em";
        const values = document.createElement("span");
        values.style.cssText = "display:flex;align-items:center;gap:6px;white-space:nowrap";
        const price = document.createElement("strong");
        price.textContent = formatValue(item, quote?.close);
        price.style.cssText = "font-size:11px;font-weight:950";
        const delta = document.createElement("span");
        delta.textContent = state.text;
        delta.style.cssText = `border-radius:999px;background:${state.background};color:${state.color};padding:3px 5px;font-size:9px;font-weight:950`;
        values.append(price, delta);
        cell.append(label, values);
        return cell;
      }));
    });
  };

  const refresh = async () => {
    try {
      const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(allSymbols.join(","))}`);
      const payload = await response.json();
      if (payload.ok) quotes = payload.quotes || {};
    } catch (_) {
      // The ticker remains usable and clearly marked while data is unavailable.
    }
    render();
  };

  const setupMarketTape = () => {
    const board = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("SIGNAL BOARD ·"));
    const header = document.querySelector("[data-market-summary-row]") || board?.parentElement;
    if (!header) return false;
    let tape = document.querySelector("[data-market-tape]");
    if (tape) return true;
    if (!document.querySelector("[data-market-tape-style]")) {
      const style = document.createElement("style");
      style.dataset.marketTapeStyle = "";
      style.textContent = "[data-market-tape-viewport]{scrollbar-width:none;-ms-overflow-style:none}[data-market-tape-viewport]::-webkit-scrollbar{display:none}@media(prefers-reduced-motion:reduce){[data-market-tape-viewport]{scroll-behavior:auto}}";
      document.head.append(style);
    }
    tape = document.createElement("section");
    tape.dataset.marketTape = "";
    tape.setAttribute("aria-label", "주요 시장 지표");
    tape.style.cssText = "margin:0 auto 12px;max-width:100%;padding:0 12px";
    const shell = document.createElement("div");
    shell.style.cssText = "display:flex;align-items:center;gap:9px;overflow:hidden;border:1px solid #dbe4f0;border-radius:12px;background:#fff;box-shadow:0 1px 2px rgba(15,23,42,.04)";
    const marker = document.createElement("span");
    marker.textContent = "MARKETS";
    marker.style.cssText = "flex:0 0 auto;border-right:1px solid #e2e8f0;background:#f8fafc;padding:10px 9px;color:#64748b;font-size:9px;font-weight:950;letter-spacing:.1em";
    const viewport = document.createElement("div");
    viewport.dataset.marketTapeViewport = "";
    viewport.style.cssText = "min-width:0;flex:1;overflow-x:auto;overflow-y:hidden;touch-action:pan-x;cursor:grab";
    const lane = document.createElement("div");
    lane.style.cssText = "display:flex;width:max-content;min-width:100%;align-items:center";
    const primary = document.createElement("div");
    primary.dataset.marketTapeTrack = "";
    primary.style.cssText = "display:flex;align-items:center;min-height:39px";
    lane.append(primary);
    viewport.append(lane);
    shell.append(marker, viewport);
    tape.append(shell);
    header.after(tape);
    const stop = () => { paused = true; clearTimeout(resumeTimer); };
    const resume = () => { clearTimeout(resumeTimer); resumeTimer = setTimeout(() => { paused = false; }, 700); };
    viewport.addEventListener("mouseenter", stop);
    viewport.addEventListener("mouseleave", resume);
    viewport.addEventListener("pointerdown", stop, { passive: true });
    viewport.addEventListener("pointerup", resume, { passive: true });
    viewport.addEventListener("pointercancel", resume, { passive: true });
    viewport.addEventListener("scroll", () => { if (!paused) resume(); }, { passive: true });
    const addTrack = () => {
      const track = document.createElement("div");
      track.dataset.marketTapeTrack = "";
      track.setAttribute("aria-hidden", "true");
      track.style.cssText = "display:flex;align-items:center;min-height:39px";
      lane.append(track);
      return track;
    };
    const ensureTrackCopies = () => {
      render();
      const primaryWidth = primary.scrollWidth;
      if (!primaryWidth) return;
      const desiredCount = Math.max(2, Math.ceil(viewport.clientWidth / primaryWidth) + 2);
      let tracks = [...lane.querySelectorAll("[data-market-tape-track]")];
      while (tracks.length < desiredCount) tracks.push(addTrack());
      while (tracks.length > desiredCount) tracks.pop()?.remove();
      render();
      if (viewport.scrollLeft >= primaryWidth) viewport.scrollLeft %= primaryWidth;
    };
    const scroll = (time) => {
      if (lastFrame && !paused && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
        const primaryWidth = primary.scrollWidth;
        if (primaryWidth > 0 && lane.scrollWidth > viewport.clientWidth) {
          viewport.scrollLeft += (Math.min(time - lastFrame, 50) * 0.032);
          if (viewport.scrollLeft >= primaryWidth) viewport.scrollLeft -= primaryWidth;
        }
      }
      lastFrame = time;
      requestAnimationFrame(scroll);
    };
    requestAnimationFrame(scroll);
    ensureTrackCopies();
    if ("ResizeObserver" in window) new ResizeObserver(ensureTrackCopies).observe(viewport);
    else window.addEventListener("resize", ensureTrackCopies, { passive: true });
    refresh();
    setInterval(refresh, 60000);
    return true;
  };

  setTimeout(setupMarketTape, 1100);
  setInterval(setupMarketTape, 5000);
})();

/* A one-line sector readout makes the board's market context visible before the cards. */
(() => {
  const sectors = [
    { name: "정보기술", symbols: ["NVDA", "AAPL", "MSFT", "AVGO", "TSM", "MU", "AMD", "ASML", "INTC", "ORCL", "CSCO", "LRCX", "AMAT", "ARM", "PLTR", "TXN", "KLAC"] },
    { name: "헬스케어", symbols: ["LLY", "JNJ", "ABBV", "UNH", "MRK", "AZN", "NVS"] },
    { name: "금융", symbols: ["BRK.B", "JPM", "V", "MA", "BAC", "HSBC", "MS", "GS", "RY"] },
    { name: "임의소비재", symbols: ["AMZN", "TSLA", "HD", "BABA"] },
    { name: "커뮤니케이션", symbols: ["GOOGL", "META", "NFLX"] },
    { name: "산업재", symbols: ["CAT", "GE", "GEV"] },
    { name: "필수소비재", symbols: ["WMT", "COST", "KO", "PG", "PM"] },
    { name: "에너지", symbols: ["XOM", "CVX"] },
    { name: "유틸리티", symbols: [] },
    { name: "부동산", symbols: [] },
    { name: "소재", symbols: [] }
  ];
  const sectorTicker = (card) => window.NasdaqWatchlistHome.tickerForCard(card);
  const sectorChange = (card) => {
    const status = window.NasdaqWatchlistView.quoteState(sectorTicker(card));
    return status.usable ? status.quote.changePercent : null;
  };

  const setupSectorFlow = () => {
    const description = [...document.querySelectorAll("*")].find((element) => element.textContent.trim() === "현재가·BB 신호는 전체 계산, 맥스페인·뉴스는 선택 종목만 조회");
    if (!description) return false;
    let flow = document.querySelector("[data-sector-flow]");
    if (!flow) {
      flow = document.createElement("section");
      flow.dataset.sectorFlow = "";
      flow.style.cssText = "display:grid;gap:6px;margin:10px 0 12px;padding:8px 10px;border:1px solid #e2e8f0;border-radius:11px;background:#f8fafc";
      description.after(flow);
    }
    const cards = [...document.querySelectorAll("button.market-compact-card")];
    if (!cards.length) return false;
    const summary = document.createElement("span");
    summary.textContent = "섹터 흐름 · 섹터를 누르면 해당 종목만 볼 수 있습니다.";
    summary.style.cssText = "display:flex;align-items:center;grid-column:1 / -1;color:#64748b;font-size:10px;font-weight:950;white-space:nowrap";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.textContent = "전체";
    reset.style.cssText = "margin-left:auto;border:0;border-radius:999px;background:#e2e8f0;color:#475569;padding:5px 8px;font-size:10px;font-weight:900;cursor:pointer";
    reset.addEventListener("click", () => cards.forEach((card) => { card.style.display = ""; }));
    summary.append(reset);
    flow.replaceChildren(summary);
    sectors.forEach((sector) => {
      const group = cards.filter((card) => sector.symbols.includes(sectorTicker(card)));
      const changes = group.map(sectorChange).filter(Number.isFinite);
      const averageChange = changes.length
        ? changes.reduce((total, value) => total + value, 0) / changes.length
        : null;
      const state = averageChange == null
        ? { symbol: "—", label: group.length ? "시세 미확인" : "해당 없음", color: "#94a3b8", bg: "#f1f5f9" }
        : averageChange >= .5
          ? { symbol: "▲", label: "강세", color: "#047857", bg: "#d1fae5" }
          : averageChange <= -.5
            ? { symbol: "▼", label: "약세", color: "#be123c", bg: "#ffe4e6" }
            : { symbol: "■", label: "보합", color: "#475569", bg: "#e2e8f0" };
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${sector.name} ${state.symbol} ${state.label}`;
      button.title = averageChange == null
        ? (group.length ? "유효한 시세를 받지 못했습니다." : `${sector.name} 섹터 종목은 현재 TOP50에 없습니다.`)
        : `${sector.name} 보드 내 ${changes.length}/${group.length}종목 평균 ${averageChange >= 0 ? "+" : ""}${averageChange.toFixed(1)}%`;
      button.disabled = !group.length;
      button.style.cssText = `min-width:0;min-height:38px;border:0;border-radius:9px;background:${state.bg};color:${state.color};padding:7px 6px;font-size:10px;font-weight:950;line-height:1.15;cursor:${group.length ? "pointer" : "not-allowed"};white-space:normal;text-align:center;opacity:${group.length ? "1" : ".72"}`;
      button.addEventListener("click", () => {
        cards.forEach((card) => { card.style.display = sector.symbols.includes(sectorTicker(card)) ? "" : "none"; });
      });
      flow.append(button);
    });
    const radarTitle = description.parentElement.firstElementChild;
    const capTitle = radarTitle?.nextElementSibling;
    let compactHeader = document.querySelector("[data-radar-compact]");
    if (!compactHeader) {
      if (!document.querySelector("[data-radar-compact-style]")) {
        const style = document.createElement("style");
        style.dataset.radarCompactStyle = "";
        style.textContent = "[data-radar-compact]{display:grid;grid-template-columns:minmax(150px,.35fr) minmax(0,2.65fr);gap:14px;align-items:center;margin:4px 0 10px}[data-sector-flow]{grid-template-columns:repeat(11,minmax(72px,1fr))}@media(max-width:1279px){[data-sector-flow]{grid-template-columns:repeat(6,minmax(80px,1fr))}}@media(max-width:900px){[data-radar-compact]{grid-template-columns:1fr;gap:8px}[data-sector-flow]{grid-template-columns:repeat(4,minmax(90px,1fr))}}@media(max-width:560px){[data-sector-flow]{grid-template-columns:repeat(2,minmax(110px,1fr))}}";
        document.head.append(style);
      }
      compactHeader = document.createElement("section");
      compactHeader.dataset.radarCompact = "";
      const titleStack = document.createElement("div");
      titleStack.style.cssText = "display:flex;flex-direction:column;gap:3px;min-width:0";
      titleStack.innerHTML = '<strong style="font-size:18px;font-weight:950;color:#0f172a" data-cap-title></strong><small data-cap-status style="color:#bfdbfe;font-size:11px"></small>';
      compactHeader.append(titleStack, flow);
      description.before(compactHeader);
      flow.style.margin = "0";
    } else {
      if (!compactHeader.contains(flow)) compactHeader.append(flow);
      flow.style.margin = "0";
    }
    compactHeader.querySelector("[data-cap-title]").textContent = capTitle?.textContent || "미국 시총 순위";
    compactHeader.querySelector("[data-cap-status]").textContent = {
      loading: "시총 순위 확인 중",
      stale: "최근 저장 순위 표시",
      fallback: "시총 순위 조회 실패 · 기본 목록",
    }[window.NasdaqWatchlistData.marketCapStatus()] || "";
    [radarTitle, capTitle, description].filter(Boolean).forEach((element) => { element.style.display = "none"; });
    return true;
  };
  setTimeout(setupSectorFlow, 0);
  setInterval(setupSectorFlow, 1000);
})();
