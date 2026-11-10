/* Favorites workspace for the deployed watchlist. The existing React list owns saved stars. */
(() => {
  const FAVORITES_KEY = "nasdaq-watchlist-favorites";
  const FAVORITES_COOKIE = "nasdaq_watchlist_favorites";
  const MARKET_CATEGORY_KEY = "nasdaq-watchlist-control:카테고리 바로 선택";
  const CATEGORY_SELECTOR = 'select[aria-label="카테고리 바로 선택"]';
  const CARD_SELECTOR = 'button.market-compact-card, button.market-action-card, button[class*="grid-cols-[42px_"]';
  const TICKER_SELECTOR = ".shrink-0.text-sm.font-black, .truncate.text-lg.font-black, .truncate.text-sm.font-black";
  const TICKER_PATTERN = /^[A-Z0-9][A-Z0-9.-]*$/;
  const formatMoney = new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  const companyNames = new Map();
  let models = new Map();
  let workspace;
  let lastMarketCategory;
  try { lastMarketCategory = localStorage.getItem(MARKET_CATEGORY_KEY); } catch {}
  let mode = "market";
  let chartOpen = false;
  let showMarketBoard = false;
  let paintQueued = false;
  let nativeActionPending = false;

  const readStored = (key, cookieKey) => {
    try {
      const value = localStorage.getItem(key);
      if (value !== null) return JSON.parse(value);
    } catch {}
    try {
      const cookie = document.cookie.split("; ").find((entry) => entry.startsWith(`${cookieKey}=`));
      return cookie ? JSON.parse(decodeURIComponent(cookie.slice(cookieKey.length + 1))) : null;
    } catch {
      return null;
    }
  };

  const readFavorites = () => {
    const value = readStored(FAVORITES_KEY, FAVORITES_COOKIE);
    return new Set(Array.isArray(value) ? value.filter((symbol) => typeof symbol === "string") : []);
  };

  const tickerForCard = (card) => {
    const ticker = card.querySelector("img[alt$=' logo']")?.alt.replace(/ logo$/, "") ||
      card.querySelector(TICKER_SELECTOR)?.textContent.trim();
    return ticker && TICKER_PATTERN.test(ticker) ? ticker.replace(/^BRK-B$/, "BRK.B") : null;
  };

  const storedCategorySymbols = (category) => {
    if (category === "all") return readStored("nasdaq-watchlist-symbols", "nasdaq_watchlist_symbols");
    if (category === "favorites") return [...readFavorites()];
    if (category?.startsWith("us-market-cap")) return null;
    const custom = readStored("nasdaq-watchlist-categories", "nasdaq_watchlist_categories");
    const customSymbols = Array.isArray(custom) ? custom.find((item) => item?.id === category)?.symbols : null;
    return customSymbols ?? readStored("nasdaq-watchlist-category-overrides", "nasdaq_watchlist_category_overrides")?.[category]?.symbols;
  };

  const nativeEntries = () => {
    const result = new Map();
    for (const button of document.querySelectorAll('article button[aria-label$=" 즐겨찾기 추가"], article button[aria-label$=" 즐겨찾기 해제"]')) {
      const symbol = button.getAttribute("aria-label").split(" ")[0];
      const article = button.closest("article");
      const company = article.querySelector(".truncate.text-xs.font-bold.text-zinc-500")?.textContent?.trim();
      if (company) companyNames.set(symbol, company);
      result.set(symbol, { article, button });
    }
    return result;
  };

  const marketSymbols = (main, entries) => {
    const symbols = new Set(entries.keys());
    const category = main.querySelector(CATEGORY_SELECTOR)?.value;
    const savedSymbols = storedCategorySymbols(category);
    if (Array.isArray(savedSymbols)) savedSymbols.filter((symbol) => TICKER_PATTERN.test(symbol)).forEach((symbol) => symbols.add(symbol));
    main.querySelectorAll('button[aria-label$=" 카테고리에서 삭제"]').forEach((item) => {
      symbols.add(item.getAttribute("aria-label").split(" ")[0]);
    });
    for (const card of main.querySelectorAll(CARD_SELECTOR)) {
      const symbol = tickerForCard(card);
      if (!symbol) continue;
      const company = card.querySelector(".truncate.font-bold.text-zinc-500, .truncate.font-bold.text-zinc-400")?.textContent?.trim();
      if (company && !companyNames.has(symbol)) companyNames.set(symbol, company);
      symbols.add(symbol);
    }
    return symbols;
  };

  const setCategory = (category) => {
    const menu = document.querySelector(CATEGORY_SELECTOR);
    if (!menu || menu.value === category || !Array.from(menu.options).some((option) => option.value === category)) return;
    menu.value = category;
    menu.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const marketCategory = (menu) => {
    const options = Array.from(menu.options);
    if (lastMarketCategory !== "favorites" && options.some((option) => option.value === lastMarketCategory)) return lastMarketCategory;
    return options.find((option) => option.textContent.includes("시총 TOP50"))?.value || "all";
  };

  const syncMode = () => {
    const menu = document.querySelector(CATEGORY_SELECTOR);
    if (!menu) return;
    if (mode === "personal" && readFavorites().size) {
      setCategory("favorites");
    } else if (mode === "market") {
      setCategory(marketCategory(menu));
    }
  };

  const queuePaint = () => {
    if (paintQueued) return;
    paintQueued = true;
    requestAnimationFrame(() => {
      paintQueued = false;
      paint();
    });
  };

  const changeMode = (next) => {
    if (next === mode) return;
    mode = next;
    chartOpen = false;
    syncMode();
    showMarketBoard = mode === "market";
    paint();
  };

  const announce = (message) => {
    if (workspace) workspace.notice.textContent = message;
  };

  const setSearchValue = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };

  const changeSignal = (menu, value) => {
    menu.value = value;
    menu.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const actOnSymbol = (symbol, action) => {
    if (nativeActionPending) return;
    const item = nativeEntries().get(symbol);
    if (item) {
      announce("");
      item[action].click();
      queuePaint();
      return;
    }

    if (action === "article") {
      const card = Array.from(document.querySelectorAll(CARD_SELECTOR)).find((item) => tickerForCard(item) === symbol);
      if (card) {
        announce("");
        card.click();
        return;
      }
    }

    // Target the React list's own search to reach stars past its first page.
    const input = document.querySelector('input[placeholder="목록에서 검색"]');
    if (!input) {
      announce(`${symbol} 항목을 열 수 없습니다.`);
      return;
    }
    const filter = document.querySelector('select[aria-label="보드 신호 필터"]');
    const previousSignal = filter?.value;
    const previousSearch = input.value;
    const resetSignal = filter && previousSignal !== "all";
    nativeActionPending = true;
    if (resetSignal) changeSignal(filter, "all");
    setSearchValue(input, symbol);

    const finish = (attempts) => {
      const entry = nativeEntries().get(symbol);
      if (!entry && attempts > 0) {
        const more = Array.from(input.closest("section")?.querySelectorAll("button") || [])
          .find((button) => button.textContent.trim().startsWith("더보기 "));
        if (more) {
          more.click();
          requestAnimationFrame(() => finish(attempts - 1));
          return;
        }
      }
      if (entry) {
        announce("");
        entry[action].click();
      } else {
        announce(`${symbol} 항목을 열 수 없습니다. 현재 카테고리를 확인하세요.`);
      }
      if (input.isConnected && input.value === symbol) setSearchValue(input, previousSearch);
      if (resetSignal && filter.isConnected && filter.value === "all") changeSignal(filter, previousSignal);
      nativeActionPending = false;
      queuePaint();
    };

    requestAnimationFrame(() => finish(4));
  };

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  };

  const setText = (node, text) => {
    if (node.textContent !== text) node.textContent = text;
  };

  const button = (className, text, handler) => {
    const node = element("button", className, text);
    node.type = "button";
    node.addEventListener("click", handler);
    return node;
  };

  const setStarLabel = (star, symbol, saved) => {
    const label = `${symbol} 즐겨찾기 ${saved ? "해제" : "추가"}`;
    setText(star, saved ? "★" : "☆");
    star.title = label;
    star.setAttribute("aria-label", label);
    star.setAttribute("aria-pressed", String(saved));
  };

  const makeRow = (symbol) => {
    const row = element("li", "watchlist-home-row");
    const detail = button("watchlist-home-detail", "", () => actOnSymbol(symbol, "article"));
    const identity = element("span", "watchlist-home-identity");
    const ticker = element("strong", "", symbol);
    const company = element("span", "watchlist-home-company");
    const quote = element("span", "watchlist-home-quote");
    const price = element("strong");
    const change = element("span");
    const decision = element("span", "watchlist-home-decision");
    const verdict = element("strong");
    const next = element("span");
    const star = button("watchlist-home-star", "", () => actOnSymbol(symbol, "button"));
    identity.append(ticker, company);
    quote.append(price, change);
    decision.append(verdict, next);
    detail.append(identity, quote, decision);
    row.append(detail, star);
    return { row, detail, company, price, change, verdict, next, star };
  };

  const renderRows = (symbols, favorites) => {
    const wanted = new Set(symbols);
    const focused = workspace.rows.contains(document.activeElement) ? document.activeElement : null;
    let lostFocus = false;
    for (const [symbol, item] of workspace.items) {
      if (wanted.has(symbol)) continue;
      lostFocus ||= focused && item.row.contains(focused);
      item.row.remove();
      workspace.items.delete(symbol);
    }
    symbols.forEach((symbol, index) => {
      const item = workspace.items.get(symbol) || makeRow(symbol);
      const model = models.get(symbol);
      const hasPrice = Number.isFinite(model?.price) && model.price > 0;
      const hasChange = Number.isFinite(model?.changePercent);
      const company = model?.name || companyNames.get(symbol) || "";
      if (model?.name) companyNames.set(symbol, model.name);
      setText(item.company, company === symbol ? "" : company);
      setText(item.price, hasPrice ? formatMoney.format(model.price) : "—");
      setText(item.change, hasChange ? `${model.changePercent > 0 ? "+" : ""}${model.changePercent.toFixed(2)}%` : "");
      item.change.dataset.tone = !hasChange || model.changePercent === 0 ? "" : model.changePercent > 0 ? "up" : "down";
      setText(item.verdict, model?.verdict || "데이터 확인 중");
      setText(item.next, Number.isFinite(model?.nextPrice) && model.nextPrice > 0
        ? `다음 확인 ${formatMoney.format(model.nextPrice)}`
        : model?.quoteUsable === false ? model.dataState || "" : "");
      item.price.title = model?.provenance || "";
      item.detail.title = `${symbol} 상세 보기`;
      setStarLabel(item.star, symbol, favorites.has(symbol));
      workspace.items.set(symbol, item);
      const atIndex = workspace.rows.children[index];
      if (atIndex !== item.row) workspace.rows.insertBefore(item.row, atIndex || null);
    });
    if (lostFocus) (workspace.rows.querySelector("button") || (mode === "market" ? workspace.search : workspace.market)).focus();
  };

  const tagMarketElements = (main) => {
    const selectors = [
      ".ticker-tape", "[data-market-tape]", "[data-market-summary-row]", CATEGORY_SELECTOR,
      '[aria-label="모바일 화면 전환"]', 'select[aria-label="보드 정렬"]',
    ];
    selectors.forEach((selector) => {
      const target = main.querySelector(selector);
      let directChild = target;
      while (directChild && directChild.parentElement !== main) directChild = directChild.parentElement;
      if (directChild) directChild.dataset.watchlistMarket = "";
    });
    const chart = main.querySelector('input[placeholder="목록에서 검색"]')?.closest("section");
    if (chart) chart.dataset.watchlistChart = "";
  };

  const addModalStar = (main, favorites) => {
    const dialog = main.querySelector('[role="dialog"][aria-modal="true"]');
    if (!dialog) return;
    const symbol = dialog.getAttribute("aria-label")?.split(" ")[0];
    if (!symbol) return;
    let star = dialog.querySelector("[data-watchlist-modal-star]");
    if (!star) {
      const footerButton = Array.from(dialog.querySelectorAll("button")).find((item) => item.textContent.includes("차트보기"));
      if (!footerButton) return;
      star = button("watchlist-home-star", "", () => actOnSymbol(star.dataset.watchlistModalStar, "button"));
      // The existing footer is a three-action layout. Add the star in a separate, right-aligned row.
      const toolbar = element("div", "watchlist-home-modal-actions");
      toolbar.append(star);
      footerButton.parentElement.before(toolbar);
    }
    star.dataset.watchlistModalStar = symbol;
    setStarLabel(star, symbol, favorites.has(symbol));
  };

  const install = (main) => {
    const entry = main.querySelector('input[aria-label="관심종목 티커 입력"]')?.closest("section");
    const menu = main.querySelector(CATEGORY_SELECTOR);
    if (!entry || !menu) return;
    menu.addEventListener("change", () => {
      if (mode !== "market" || menu.value === "favorites") return;
      lastMarketCategory = menu.value;
      try { localStorage.setItem(MARKET_CATEGORY_KEY, lastMarketCategory); } catch {}
    });
    const container = element("section", "watchlist-home");
    container.setAttribute("aria-label", "관심종목 작업공간");
    const panel = element("div", "watchlist-home-panel");
    const heading = element("h2", "watchlist-home-title");
    const tabs = element("div", "watchlist-home-tabs");
    tabs.setAttribute("aria-label", "관심종목 화면 전환");
    tabs.setAttribute("role", "group");
    const personal = button("", "내 관심종목", () => changeMode("personal"));
    const market = button("", "시장 탐색", () => changeMode("market"));
    tabs.append(personal, market);
    const header = element("div", "watchlist-home-header");
    header.append(heading, tabs);
    const search = element("input", "watchlist-home-search");
    search.type = "search";
    search.placeholder = "티커 또는 회사명 검색";
    search.setAttribute("aria-label", "시장 탐색 티커 또는 회사명 검색");
    search.addEventListener("input", paint);
    const status = element("p", "watchlist-home-status");
    const notice = element("p", "watchlist-home-notice");
    notice.setAttribute("role", "status");
    const rows = element("ul", "watchlist-home-list");
    panel.append(header, search, status, rows, notice);
    container.append(panel);
    entry.after(container);
    main.addEventListener("click", (event) => {
      const nativeButton = event.target.closest("button");
      if (!nativeButton?.textContent.includes("차트보기")) return;
      chartOpen = true;
      main.dataset.watchlistChartOpen = "true";
    }, true);
    workspace = { main, heading, personal, market, search, status, rows, notice, items: new Map() };
    syncMode();
  };

  function paint() {
    const main = document.querySelector("#root > main");
    if (!main) return;
    if (!workspace) install(main);
    if (!workspace) return;
    if (showMarketBoard) {
      const board = main.querySelector('[aria-label="모바일 화면 전환"] button:first-child');
      if (board) {
        showMarketBoard = false;
        if (board.getAttribute("aria-pressed") === "false") board.click();
      }
    }
    tagMarketElements(main);
    const favorites = readFavorites();
    if (mode === "personal" && !favorites.size) chartOpen = false;
    main.dataset.watchlistMode = mode;
    main.dataset.watchlistChartOpen = String(chartOpen);
    const entries = nativeEntries();
    const isMarket = mode === "market";
    setText(workspace.heading, isMarket ? "시장 탐색" : "내 관심종목");
    workspace.personal.setAttribute("aria-pressed", String(!isMarket));
    workspace.market.setAttribute("aria-pressed", String(isMarket));
    workspace.search.hidden = !isMarket;
    addModalStar(main, favorites);

    const keyword = workspace.search.value.trim().toLocaleLowerCase("ko-KR");
    const candidates = isMarket
      ? keyword ? [...marketSymbols(main, entries)].filter((symbol) => `${symbol} ${companyNames.get(symbol) || models.get(symbol)?.name || ""}`.toLocaleLowerCase("ko-KR").includes(keyword)) : []
      : [...favorites];
    const shown = isMarket ? candidates.slice(0, 8) : candidates;
    setText(workspace.status, isMarket
      ? !keyword ? "현재 카테고리에서 종목을 검색하고 별표로 저장하세요."
        : !candidates.length ? "현재 카테고리에 검색 결과가 없습니다."
        : candidates.length > shown.length ? `검색 결과 ${shown.length} / ${candidates.length}` : `검색 결과 ${shown.length}개`
      : favorites.size ? `즐겨찾기 ${favorites.size}종목` : "시장 탐색에서 별표를 눌러 자주 보는 종목을 모아보세요.");
    renderRows(shown, favorites);
  }

  window.NasdaqWatchlistHome = {
    tickerForCard,
    render(nextModels) {
      if (nextModels instanceof Map) models = nextModels;
      queuePaint();
    },
  };
  const root = document.getElementById("root");
  if (root) {
    const observer = new MutationObserver((records) => {
      if (records.some(({ target }) => !target.closest?.(".watchlist-home, .watchlist-home-modal-actions"))) queuePaint();
    });
    observer.observe(root, { childList: true, subtree: true });
  }
  window.addEventListener("storage", (event) => {
    if (event.key === FAVORITES_KEY || event.key === null) queuePaint();
  });
  queuePaint();
})();
