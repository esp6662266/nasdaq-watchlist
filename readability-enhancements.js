/* Start with market-cap order, then remember the board controls the user changes. */
(() => {
  const keyFor = (menu, index) => `nasdaq-watchlist-control:${menu.getAttribute("aria-label") || menu.name || index}`;
  const applyPreferences = () => {
    const menus = [...document.querySelectorAll("select")];
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

/* Local score prototype: trend 30 + Bollinger position 25 + momentum 20 + volume 15 - risk 10. */
(() => {
  const average = values => values.reduce((sum, value) => sum + value, 0) / values.length;
  const score = rows => {
    if (!rows || rows.length < 22) return null;
    const close = rows.map(row => row.close).filter(Number.isFinite);
    const volume = rows.map(row => row.volume).filter(Number.isFinite);
    const last = close.at(-1), prior = close.at(-2), sma20 = average(close.slice(-20)), sma50 = average(close.slice(-50));
    const deviation = Math.sqrt(average(close.slice(-20).map(value => (value - sma20) ** 2)));
    let value = 0;
    value += last > sma20 ? 10 : 0; value += sma20 > sma50 ? 10 : 0; value += last > sma50 ? 10 : 0;
    const bb = deviation ? (last - (sma20 - 2 * deviation)) / (4 * deviation) : .5;
    value += bb < .25 && last >= prior ? 25 : bb < .45 ? 15 : bb < .8 ? 5 : 0;
    value += last > close.at(-6) ? 10 : 0; value += last > close.at(-21) ? 10 : 0;
    value += volume.at(-1) > average(volume.slice(-20)) * 1.2 && last >= prior ? 15 : 5;
    const volatility = average(close.slice(-14).map((value, index, list) => index ? Math.abs(value / list[index - 1] - 1) : 0));
    return Math.max(0, Math.min(100, Math.round(value - Math.min(10, volatility * 250))));
  };
  window.localSignalScore = score;
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

/* Give each compact card one compact, readable view of its score and recent price action. */
(() => {
  const historyBySymbol = new Map();
  const pendingSymbols = new Set();
  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  let marketFilter = { label: "시장 확인 중", detail: "QQQ 일봉을 불러오는 중입니다.", color: "#64748b", background: "#f1f5f9" };
  let marketFilterLoaded = false;
  let marketFilterPending = false;
  const earningsBySymbol = new Map();
  let earningsLoaded = false;
  let earningsPending = false;
  let earningsAsOf = null;

  const getSymbol = (card) => {
    const logo = card.querySelector("img[alt$=' logo']");
    if (logo?.alt) {
      const symbol = logo.alt.replace(/ logo$/, "").toUpperCase();
      return symbol === "BRK-B" ? "BRK.B" : symbol;
    }
    return card.textContent.match(/\b(?:AAPL|MSFT|GOOGL|AMZN|NVDA|META|TSLA|QQQ|SPY|DIA|[A-Z]{1,5})\b/)?.[0] || null;
  };

  // Keep the user-facing Berkshire symbol as BRK.B, while querying the data
  // provider with its stable dash-separated identifier.
  const providerSymbol = (symbol) => symbol === "BRK.B" ? "BRK-B" : symbol;

  const makePoints = (rows) => {
    const values = rows.slice(-20).map((row) => Number(row.close)).filter(Number.isFinite);
    if (values.length < 2) return "";
    const low = Math.min(...values), high = Math.max(...values), span = high - low || 1;
    return values.map((value, index) => {
      const x = (index / (values.length - 1)) * 100;
      const y = 28 - ((value - low) / span) * 24;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  };

  const scoreStyle = (score) => {
    if (score >= 75) return { label: "추세 우세", color: "#1d4ed8", background: "#dbeafe" };
    if (score >= 60) return { label: "진입 검토", color: "#0369a1", background: "#e0f2fe" };
    if (score >= 40) return { label: "대기", color: "#475569", background: "#e2e8f0" };
    return { label: "관찰 필요", color: "#be123c", background: "#ffe4e6" };
  };

  const explainSignal = (rows) => {
    const recent = rows.slice(-20);
    const closes = recent.map((row) => Number(row.close)).filter(Number.isFinite);
    const volumes = recent.map((row) => Number(row.volume)).filter(Number.isFinite);
    if (closes.length < 20) return { label: "지표 확인 중", detail: "최근 지표 데이터가 충분하지 않습니다." };

    const last = closes.at(-1);
    const prior = closes.at(-2);
    const sma20 = average(closes);
    const deviation = Math.sqrt(average(closes.map((value) => (value - sma20) ** 2)));
    const bbPosition = deviation ? ((last - (sma20 - 2 * deviation)) / (4 * deviation)) * 100 : 50;
    const latestSession = recent.at(-1)?.time;
    const marketDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const isInProgressSession = latestSession === marketDate;
    // Compare a finished daily candle with the prior 19 completed sessions only.
    const completedVolumes = isInProgressSession ? volumes.slice(0, -1) : volumes;
    const volumeAverage = completedVolumes.length ? average(completedVolumes) : null;
    const volumeRatio = volumeAverage ? volumes.at(-1) / volumeAverage : null;
    const fiveDayBase = closes.at(-6);
    const fiveDayReturn = fiveDayBase ? ((last / fiveDayBase) - 1) * 100 : 0;

    let label = "지표 혼조";
    if (bbPosition <= 15) label = "BB 하단권";
    else if (bbPosition >= 85) label = "BB 상단권";
    else if (last < sma20 && fiveDayReturn < 0) label = "20일선 아래";
    else if (last > sma20 && fiveDayReturn > 0) label = "20일선 위";
    else if (last < prior) label = "단기 하락";
    else if (last > prior) label = "단기 상승";
    else if (!isInProgressSession && volumeRatio != null && volumeRatio < 0.8) label = "거래량 부족";
    else if (!isInProgressSession && volumeRatio != null && volumeRatio >= 1.5) label = "거래량 증가";

    const volumeText = volumeRatio == null
      ? "거래량 비교 불가"
      : isInProgressSession
        ? `장중 거래량은 20일 평균의 ${volumeRatio.toFixed(2)}배 (진행 중)`
        : `거래량은 20일 평균의 ${volumeRatio.toFixed(2)}배`;
    const positionText = `BB 위치 ${Math.max(0, Math.min(100, bbPosition)).toFixed(0)}%`;
    const trendText = `종가는 20일선 ${last >= sma20 ? "위" : "아래"}`;
    const momentumText = `5일 ${fiveDayReturn >= 0 ? "+" : ""}${fiveDayReturn.toFixed(1)}%`;
    return { label, detail: `${volumeText} · ${positionText} · ${trendText} · ${momentumText}` };
  };

  // Reference-only swing levels derived from the latest completed daily candles.
  // They are planning levels, not an instruction to buy or sell.
  const makeSwingPlan = (rows) => {
    const recent = rows.slice(-12).filter((row) => Number.isFinite(Number(row.close)));
    if (recent.length < 7) return null;
    const previous = recent.at(-2);
    const entry = Number.isFinite(Number(previous.high)) ? Number(previous.high) : Number(previous.close);
    const lows = recent.slice(-6).map((row) => Number(row.low ?? row.close)).filter(Number.isFinite);
    const stop = Math.min(...lows);
    const risk = entry - stop;
    if (!Number.isFinite(entry) || !Number.isFinite(stop) || risk <= 0) return null;
    const target = entry + risk * 2;
    const price = (value) => `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
    return {
      entry: price(entry),
      stop: price(stop),
      target: price(target),
      ratio: "2.0R",
      detail: `전일 고점 ${price(entry)} 돌파 확인 · 최근 6일 저점 ${price(stop)} 이탈 시 계획 무효`,
    };
  };

  const classifySwingSetup = (rows) => {
    const recent = rows.slice(-60).filter((row) => Number.isFinite(Number(row.close)));
    if (recent.length < 22) return { label: "셋업 대기", detail: "일봉 데이터가 충분하지 않아 패턴을 분류하지 않습니다.", color: "#64748b", background: "#f1f5f9" };
    const closes = recent.map((row) => Number(row.close));
    const latest = recent.at(-1);
    const previous = recent.at(-2);
    const last = closes.at(-1);
    const prior = closes.at(-2);
    const sma20 = average(closes.slice(-20));
    const sma50 = recent.length >= 50 ? average(closes.slice(-50)) : average(closes.slice(-30));
    const deviation = Math.sqrt(average(closes.slice(-20).map((value) => (value - sma20) ** 2)));
    const bbPosition = deviation ? (last - (sma20 - 2 * deviation)) / (4 * deviation) : 0.5;
    const previousTenHigh = Math.max(...recent.slice(-11, -1).map((row) => Number(row.high ?? row.close)).filter(Number.isFinite));
    const previousFiveHigh = Math.max(...recent.slice(-6, -1).map((row) => Number(row.high ?? row.close)).filter(Number.isFinite));
    const volumes = recent.slice(-21, -1).map((row) => Number(row.volume)).filter(Number.isFinite);
    const volumeRatio = volumes.length && Number.isFinite(Number(latest.volume)) ? Number(latest.volume) / average(volumes) : null;

    if (Number.isFinite(previousTenHigh) && last > previousTenHigh * 1.001 && (volumeRatio == null || volumeRatio >= 1.15)) {
      return { label: "박스 돌파", detail: "최근 10일 고점 돌파와 거래량 확인 구간입니다.", color: "#0369a1", background: "#e0f2fe" };
    }
    if (last > sma20 && sma20 >= sma50 && last < previousFiveHigh && last >= prior) {
      return { label: "추세 눌림목", detail: "상승 추세 안에서 눌림 뒤 반등 확인을 보는 구간입니다.", color: "#1d4ed8", background: "#dbeafe" };
    }
    if (bbPosition <= 0.3 && last >= prior) {
      return { label: "하단 반등", detail: "볼린저밴드 하단권의 반등 시도입니다. 확인 전 추격은 피합니다.", color: "#0369a1", background: "#e0f2fe" };
    }
    if (last < sma20 && sma20 < sma50) {
      return { label: "추세 이탈", detail: "단기와 중기 추세가 모두 약해 신규 진입보다 관찰이 우선입니다.", color: "#be123c", background: "#ffe4e6" };
    }
    return { label: "셋업 대기", detail: "현재는 진입 패턴이 뚜렷하지 않아 방향 확인이 필요합니다.", color: "#475569", background: "#e2e8f0" };
  };

  const classifyMarketFilter = (rows) => {
    const closes = rows.slice(-60).map((row) => Number(row.close)).filter(Number.isFinite);
    if (closes.length < 22) return { label: "시장 확인 중", detail: "QQQ 일봉 데이터가 충분하지 않습니다.", color: "#64748b", background: "#f1f5f9" };
    const last = closes.at(-1);
    const sma20 = average(closes.slice(-20));
    const sma50 = closes.length >= 50 ? average(closes.slice(-50)) : average(closes.slice(-30));
    if (last >= sma20 && sma20 >= sma50) return { label: "시장 우호", detail: "QQQ가 20일선 위이며 중기 추세도 우호적입니다.", color: "#166534", background: "#dcfce7" };
    if (last < sma20 && sma20 < sma50) return { label: "시장 방어", detail: "QQQ의 단기·중기 추세가 약해 신규 롱 스윙은 보수적으로 봅니다.", color: "#be123c", background: "#ffe4e6" };
    return { label: "시장 중립", detail: "QQQ 방향이 엇갈려 개별 종목의 확인 신호가 더 중요합니다.", color: "#475569", background: "#e2e8f0" };
  };

  const earningsStatus = (symbol) => {
    if (!earningsLoaded) return { label: "실적 일정 확인 중", detail: "NASDAQ 공개 캘린더를 불러오는 중입니다.", color: "#64748b", background: "#f1f5f9" };
    const event = earningsBySymbol.get(providerSymbol(symbol));
    if (!event) return { label: "실적 · 7일 내 일정 없음", detail: "NASDAQ 공개 캘린더의 향후 7일 기준입니다.", color: "#64748b", background: "#f8fafc" };
    const days = earningsAsOf ? Math.max(0, Math.round((Date.parse(`${event.date}T12:00:00Z`) - Date.parse(`${earningsAsOf}T12:00:00Z`)) / 86400000)) : null;
    const time = event.time === "time-pre-market" ? "장전" : event.time === "time-after-market" ? "장후" : "시간 미정";
    const closeRisk = Number.isFinite(days) && days <= 2;
    return {
      label: `실적 D-${days ?? "?"} · ${time}`,
      detail: `${event.date} ${time} 실적 발표 예정. 이벤트 전 신규 스윙 진입은 보수적으로 검토합니다.`,
      color: closeRisk ? "#be123c" : "#9a3412",
      background: closeRisk ? "#ffe4e6" : "#ffedd5",
    };
  };

  const removeDuplicatePrimarySignal = (card) => {
    card.querySelectorAll("[data-primary-signal]").forEach((element) => element.remove());
    card.querySelectorAll("*").forEach((element) => {
      if (element.textContent.trim() === "BUY SELL") element.style.display = "none";
    });
  };

  // Make the swing state visible where the original one-word signal was shown.
  // The raw signal remains available in a data attribute for later scoring rules.
  const renderSwingHeaderStatus = (card) => {
    const states = {
      "매수": { label: "진입 후보", detail: "하단·반등 조건을 추가 확인", color: "#1d4ed8", background: "#dbeafe" },
      "관망": { label: "대기", detail: "추세 또는 반등 확인 신호 부족", color: "#475569", background: "#e2e8f0" },
      "추격": { label: "추격 금지", detail: "가격이 확장된 구간 — 눌림 대기", color: "#be123c", background: "#ffe4e6" },
      "축소": { label: "익절/축소 검토", detail: "상단·과열 구간 — 신규 진입 보류", color: "#be123c", background: "#ffe4e6" },
    };
    const header = card.firstElementChild;
    const leftGroup = header?.firstElementChild;
    const badge = [...(leftGroup?.children || [])].find((element) => states[element.dataset.rawSignal || element.textContent.trim()]);
    if (!badge) return;
    const rawSignal = badge.dataset.rawSignal || badge.textContent.trim();
    const state = states[rawSignal];
    badge.dataset.rawSignal = rawSignal;
    badge.dataset.swingHeaderStatus = "";
    badge.textContent = state.label;
    badge.title = state.detail;
    badge.setAttribute("aria-label", `${state.label}. ${state.detail}`);
    badge.style.cssText = `border-radius:999px;padding:3px 7px;background:${state.background};color:${state.color};font-size:9px;font-weight:900;line-height:1.2;white-space:nowrap`;
  };

  const renderCard = (card, symbol, rows) => {
    const existing = card.querySelector("[data-compact-insight]");
    if (existing) existing.remove();
    const score = window.localSignalScore?.(rows);
    const points = makePoints(rows);
    if (score == null || !points) return;
    removeDuplicatePrimarySignal(card);
    renderSwingHeaderStatus(card);
    const style = scoreStyle(score);
    const reason = explainSignal(rows);
    const swingPlan = makeSwingPlan(rows);
    const swingSetup = classifySwingSetup(rows);
    const earnings = earningsStatus(symbol);
    const closes = rows.map((row) => Number(row.close)).filter(Number.isFinite);
    const first = closes.at(-1), previous = closes.at(-2);
    const recent = closes.slice(-20);
    const average = recent.reduce((sum, value) => sum + value, 0) / recent.length;
    const deviation = Math.sqrt(recent.reduce((sum, value) => sum + (value - average) ** 2, 0) / recent.length);
    const lower = average - 2 * deviation;
    const lowerDistance = ((first - lower) / first) * 100;
    const monthAgo = closes.at(-21);
    const monthReturn = monthAgo ? ((first / monthAgo) - 1) * 100 : null;
    const distanceText = lowerDistance <= 0 ? "BB 하단 이탈" : `BB 하단까지 ${lowerDistance.toFixed(1)}%`;
    const returnText = monthReturn == null ? "1개월 수익률 -" : `1개월 ${monthReturn >= 0 ? "+" : ""}${monthReturn.toFixed(1)}%`;
    const lineColor = first >= previous ? "#2563eb" : "#e11d48";
    const insight = document.createElement("div");
    insight.dataset.compactInsight = "";
    insight.dataset.chartKey = symbol.replace(/[^A-Z0-9_-]/g, "_");
    insight.setAttribute("aria-label", `${symbol} 신호 점수 ${score}점, ${style.label}, 이유 ${reason.label}. ${reason.detail}. 최근 20일 가격 흐름`);
    insight.style.cssText = "display:flex;flex-direction:column;gap:5px;margin-top:8px;padding:7px 54px 7px 7px;border-radius:8px;background:rgba(248,250,252,.9);min-height:76px";
    const planMarkup = swingPlan ? `<div data-swing-plan style="margin-top:2px;border-top:1px solid #e2e8f0;padding-top:6px"><div style="display:flex;align-items:center;justify-content:space-between;gap:4px;margin-bottom:4px"><span style="font-size:8px;font-weight:950;letter-spacing:.05em;color:#64748b">스윙 계획 · 참고</span><span data-swing-setup style="overflow:hidden;text-overflow:ellipsis;border-radius:999px;padding:3px 5px;background:${swingSetup.background};color:${swingSetup.color};font-size:8px;font-weight:950;white-space:nowrap" title="${swingSetup.detail}">${swingSetup.label}</span></div><span data-market-filter style="display:block;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;border-radius:6px;padding:4px 5px;background:${marketFilter.background};color:${marketFilter.color};font-size:8px;font-weight:900;white-space:nowrap" title="${marketFilter.detail}">QQQ 필터 · ${marketFilter.label}</span><span data-earnings-alert style="display:block;margin-bottom:5px;overflow:hidden;text-overflow:ellipsis;border-radius:6px;padding:4px 5px;background:${earnings.background};color:${earnings.color};font-size:8px;font-weight:900;white-space:nowrap" title="${earnings.detail}">${earnings.label}</span><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px"><span style="min-width:0;border-radius:6px;background:#fff;padding:4px"><small style="display:block;font-size:8px;font-weight:800;color:#64748b">진입 확인</small><strong style="display:block;overflow:hidden;text-overflow:ellipsis;font-size:9px;color:#1d4ed8;white-space:nowrap">${swingPlan.entry}</strong></span><span style="min-width:0;border-radius:6px;background:#fff;padding:4px"><small style="display:block;font-size:8px;font-weight:800;color:#64748b">손절 기준</small><strong style="display:block;overflow:hidden;text-overflow:ellipsis;font-size:9px;color:#be123c;white-space:nowrap">${swingPlan.stop}</strong></span><span style="min-width:0;border-radius:6px;background:#fff;padding:4px"><small style="display:block;font-size:8px;font-weight:800;color:#64748b">1차 목표</small><strong style="display:block;overflow:hidden;text-overflow:ellipsis;font-size:9px;color:#0369a1;white-space:nowrap">${swingPlan.target}</strong></span><span style="min-width:0;border-radius:6px;background:#fff;padding:4px"><small style="display:block;font-size:8px;font-weight:800;color:#64748b">손익비</small><strong style="display:block;font-size:9px;color:#0369a1">${swingPlan.ratio}</strong></span></div></div>` : "";
    insight.innerHTML = `<span style="display:flex;align-items:center;gap:7px;min-width:0"><span style="display:flex;min-width:57px;flex-direction:column;line-height:1.05"><span style="font-size:9px;font-weight:900;letter-spacing:.04em;color:#64748b">신호 점수</span><strong style="font-size:16px;font-weight:950;color:${style.color}">${score}<small style="font-size:9px;margin-left:1px">/100</small></strong></span><span data-signal-reason style="font-size:9px;font-weight:900;color:${style.color};background:${style.background};padding:3px 5px;border-radius:999px;white-space:nowrap"><span data-signal-status>${style.label}</span><span data-signal-reason-text> · ${reason.label}</span></span></span><svg viewBox="0 0 100 32" preserveAspectRatio="none" role="img" aria-label="최근 20일 미니 차트" style="width:100%;height:36px;overflow:visible"><polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg><span style="font-size:9px;font-weight:800;color:#64748b;white-space:nowrap">${distanceText} · ${returnText}</span>${planMarkup}`;
    const reasonLabel = insight.querySelector("[data-signal-reason]");
    reasonLabel.setAttribute("title", reason.detail);
    reasonLabel.setAttribute("aria-label", `${style.label}. 이유: ${reason.label}. ${reason.detail}`);
    reasonLabel.dataset.reasonDetail = reason.detail;
    if (swingPlan) insight.querySelector("[data-swing-plan]")?.setAttribute("title", swingPlan.detail);
    const metrics = card.querySelector(":scope > .mt-2.grid.grid-cols-3");
    if (metrics) metrics.before(insight); else card.append(insight);
  };

  const fetchHistory = async (symbols) => {
    if (!symbols.length) return;
    symbols.forEach((symbol) => pendingSymbols.add(symbol));
    try {
      const requestedSymbols = symbols.map(providerSymbol);
      const response = await fetch(`/api/history?symbols=${encodeURIComponent(requestedSymbols.join(","))}`);
      const payload = await response.json();
      if (!payload.ok) return;
      for (let index = 0; index < symbols.length; index += 1) {
        const symbol = symbols[index];
        const rows = payload.history?.[requestedSymbols[index]] ?? payload.history?.[symbol];
        if (Array.isArray(rows)) historyBySymbol.set(symbol, rows);
      }
    } catch (_) {
      // Cards remain readable if the optional history request is unavailable.
    } finally {
      symbols.forEach((symbol) => pendingSymbols.delete(symbol));
    }
  };

  const fetchMarketFilter = async () => {
    if (marketFilterLoaded || marketFilterPending) return;
    marketFilterPending = true;
    try {
      const response = await fetch("/api/history?symbols=QQQ");
      const payload = await response.json();
      const rows = payload.history?.QQQ;
      if (payload.ok && Array.isArray(rows)) {
        marketFilter = classifyMarketFilter(rows);
        marketFilterLoaded = true;
      }
    } catch (_) {
      marketFilter = { label: "시장 확인 불가", detail: "QQQ 데이터를 불러오지 못해 개별 종목 판단만 표시합니다.", color: "#64748b", background: "#f1f5f9" };
    } finally {
      marketFilterPending = false;
    }
  };

  const fetchEarnings = async (symbols) => {
    if (earningsLoaded || earningsPending || !symbols.length) return;
    earningsPending = true;
    try {
      const response = await fetch(`/.netlify/functions/earnings?days=7&symbols=${encodeURIComponent(symbols.map(providerSymbol).join(","))}`);
      const payload = await response.json();
      if (!payload.ok) return;
      Object.entries(payload.events || {}).forEach(([symbol, event]) => earningsBySymbol.set(symbol, event));
      earningsAsOf = payload.asOf || null;
      earningsLoaded = true;
    } catch (_) {
      // A missing event feed must never prevent price and trend data from rendering.
    } finally {
      earningsPending = false;
    }
  };

  const renderTodaySwingBoard = (cards) => {
    const existing = document.querySelector("[data-today-swing-board]");
    const entryBySymbol = new Map();
    cards.forEach((card) => {
      const symbol = getSymbol(card);
      const rows = symbol && historyBySymbol.get(symbol);
      if (!symbol || !rows || entryBySymbol.has(symbol)) return;
      const setup = classifySwingSetup(rows);
      const score = window.localSignalScore?.(rows) ?? 0;
      const earnings = earningsStatus(symbol);
      entryBySymbol.set(symbol, { symbol, setup, score, earnings });
    });
    const entries = [...entryBySymbol.values()];
    const groups = ["추세 눌림목", "하단 반등", "박스 돌파"].map((label) => ({
      label,
      items: entries.filter((entry) => entry.setup.label === label).sort((a, b) => b.score - a.score).slice(0, 3),
    })).filter((group) => group.items.length);
    if (!groups.length) {
      existing?.remove();
      return;
    }
    const board = existing || document.createElement("section");
    board.dataset.todaySwingBoard = "";
    board.style.cssText = "grid-column:1/-1;margin:0 0 12px;border:1px solid #bfdbfe;border-radius:16px;background:linear-gradient(135deg,#eff6ff,#fff);padding:12px;box-shadow:0 8px 22px rgba(15,23,42,.06)";
    board.innerHTML = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:9px"><div><div style="font-size:11px;font-weight:950;letter-spacing:.08em;color:#1d4ed8">TODAY'S SWING CANDIDATES</div><div style="margin-top:2px;font-size:11px;font-weight:800;color:#475569">전체 50개 중 셋업이 확인된 종목만 요약 · 매매 지시 아님</div></div><span style="border-radius:999px;padding:4px 7px;background:${marketFilter.background};color:${marketFilter.color};font-size:10px;font-weight:950;white-space:nowrap">QQQ ${marketFilter.label}</span></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:7px">${groups.map((group) => `<div style="border-radius:10px;background:#fff;padding:8px"><div style="margin-bottom:6px;font-size:10px;font-weight:950;color:#334155">${group.label}</div>${group.items.map((entry) => `<div style="display:flex;align-items:center;justify-content:space-between;gap:5px;padding:4px 0;border-top:1px solid #f1f5f9"><span style="font-size:11px;font-weight:950;color:#0f172a">${entry.symbol}</span><span style="overflow:hidden;text-overflow:ellipsis;font-size:9px;font-weight:850;color:${entry.earnings.color};white-space:nowrap" title="${entry.earnings.detail}">${entry.earnings.label}</span><span style="font-size:9px;font-weight:900;color:#2563eb">${entry.score}점</span></div>`).join("")}</div>`).join("")}</div>`;
    const cardContainer = cards[0]?.parentElement;
    if (!existing && cardContainer) cardContainer.before(board);
  };

  const notifiedAlerts = new Set();

  const notifySwingAlerts = (alerts) => {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    alerts.forEach((alert) => {
      if (notifiedAlerts.has(alert.key)) return;
      notifiedAlerts.add(alert.key);
      new Notification(`스윙 알림 · ${alert.symbol}`, { body: `${alert.type} — ${alert.detail}` });
    });
  };

  const collectSwingAlerts = (cards) => {
    const seen = new Set();
    const alerts = [];
    cards.forEach((card) => {
      const symbol = getSymbol(card);
      const rows = symbol && historyBySymbol.get(symbol);
      if (!symbol || !rows || seen.has(symbol)) return;
      seen.add(symbol);
      const recent = rows.slice(-8).filter((row) => Number.isFinite(Number(row.close)));
      if (recent.length < 7) return;
      const latest = recent.at(-1);
      const previous = recent.at(-2);
      const entry = Number(previous.high ?? previous.close);
      const priorLows = recent.slice(-7, -1).map((row) => Number(row.low ?? row.close)).filter(Number.isFinite);
      const stop = Math.min(...priorLows);
      const target = entry + (entry - stop) * 2;
      const close = Number(latest.close);
      const earnings = earningsStatus(symbol);
      if (Number.isFinite(stop) && close <= stop) alerts.push({ key: `${symbol}-stop`, symbol, type: "손절 기준 이탈", detail: `종가가 최근 6일 저점 기준 아래입니다.`, color: "#be123c" });
      else if (Number.isFinite(target) && close >= target) alerts.push({ key: `${symbol}-target`, symbol, type: "1차 목표 도달", detail: `2R 참고 목표 구간에 도달했습니다.`, color: "#166534" });
      else if (Number.isFinite(entry) && close >= entry) alerts.push({ key: `${symbol}-breakout`, symbol, type: "전일 고점 돌파", detail: `종가가 전일 고점 기준을 넘었습니다.`, color: "#1d4ed8" });
      if (earnings.label.startsWith("실적 D-0") || earnings.label.startsWith("실적 D-1") || earnings.label.startsWith("실적 D-2")) {
        alerts.push({ key: `${symbol}-earnings-${earnings.label}`, symbol, type: earnings.label, detail: "실적 임박 구간 — 신규 스윙 진입은 보수적으로 검토합니다.", color: "#be123c" });
      }
    });
    return alerts.slice(0, 8);
  };

  const renderSwingAlerts = (cards) => {
    const alerts = collectSwingAlerts(cards);
    const existing = document.querySelector("[data-swing-alert-board]");
    const board = existing || document.createElement("section");
    board.dataset.swingAlertBoard = "";
    board.style.cssText = "grid-column:1/-1;margin:0 0 10px;border:1px solid #fde68a;border-radius:16px;background:#fffbeb;padding:11px";
    const notificationEnabled = "Notification" in window && Notification.permission === "granted";
    board.innerHTML = `<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:${alerts.length ? "8px" : "0"}"><div><div style="font-size:11px;font-weight:950;letter-spacing:.08em;color:#92400e">SWING ALERTS</div><div style="margin-top:2px;font-size:10px;font-weight:800;color:#78716c">조건 충족 알림 · 매매 지시 아님</div></div><button type="button" data-enable-swing-notifications style="border:1px solid #fcd34d;border-radius:999px;background:#fff;padding:5px 8px;color:#92400e;font-size:10px;font-weight:950;white-space:nowrap">${notificationEnabled ? "브라우저 알림 사용 중" : "브라우저 알림 켜기"}</button></div>${alerts.length ? `<div style="display:grid;gap:5px">${alerts.map((alert) => `<div style="display:flex;align-items:center;gap:6px;border-radius:8px;background:#fff;padding:6px"><strong style="min-width:42px;color:#0f172a;font-size:10px">${alert.symbol}</strong><span style="font-size:10px;font-weight:950;color:${alert.color}">${alert.type}</span><span style="overflow:hidden;text-overflow:ellipsis;color:#64748b;font-size:9px;white-space:nowrap">${alert.detail}</span></div>`).join("")}</div>` : `<div style="color:#78716c;font-size:10px;font-weight:800">현재 새로 충족된 조건이 없습니다.</div>`}`;
    const enableButton = board.querySelector("[data-enable-swing-notifications]");
    enableButton?.addEventListener("click", async () => {
      if (!("Notification" in window)) {
        enableButton.textContent = "이 브라우저는 미지원";
        return;
      }
      const permission = await Notification.requestPermission();
      enableButton.textContent = permission === "granted" ? "브라우저 알림 사용 중" : "브라우저 알림 미허용";
      if (permission === "granted") notifySwingAlerts(alerts);
    }, { once: true });
    notifySwingAlerts(alerts);
    const cardContainer = cards[0]?.parentElement;
    const candidatesBoard = document.querySelector("[data-today-swing-board]");
    if (!existing && candidatesBoard) candidatesBoard.before(board);
    else if (!existing && cardContainer) cardContainer.before(board);
  };

  const enhance = async () => {
    const compactCards = [...document.querySelectorAll("button.market-compact-card")];
    const actionCards = [...document.querySelectorAll("button.market-action-card")];
    const summaryCards = compactCards.length ? compactCards : actionCards;
    if (!summaryCards.length || !window.localSignalScore) return;
    await fetchMarketFilter();
    await fetchEarnings(summaryCards.map(getSymbol).filter(Boolean));
    const required = [];
    for (const card of summaryCards) {
      const symbol = getSymbol(card);
      if (!symbol) continue;
      const rows = historyBySymbol.get(symbol);
      if (rows) renderCard(card, symbol, rows);
      else if (!pendingSymbols.has(symbol)) required.push(symbol);
    }
    for (let start = 0; start < required.length; start += 12) await fetchHistory(required.slice(start, start + 12));
    for (const card of compactCards) {
      const symbol = getSymbol(card);
      const rows = symbol && historyBySymbol.get(symbol);
      if (rows) renderCard(card, symbol, rows);
    }
    renderTodaySwingBoard(summaryCards);
    renderSwingAlerts(summaryCards);
  };

  setTimeout(enhance, 1800);
  setInterval(enhance, 30000);
})();

/* Keep the detailed board controls, without a duplicate quick-filter row above them. */
(() => {
  const setupFilterBar = () => {
    const signalMenu = document.querySelector('select[aria-label="보드 신호 필터"]');
    const sortMenu = document.querySelector('select[aria-label="보드 정렬"]');
    const categoryMenu = document.querySelector('select[aria-label="카테고리 바로 선택"]');
    if (!signalMenu || !sortMenu || !categoryMenu) return false;
    const panel = signalMenu.parentElement;
    if (!panel || panel.dataset.filterPanel) return true;
    const categorySection = categoryMenu.closest("section");
    if (categorySection) categorySection.style.display = "none";
    panel.dataset.filterPanel = "true";
    panel.style.display = "grid";
    panel.style.marginTop = "8px";
    const categoryPicker = categoryMenu.cloneNode(true);
    categoryPicker.removeAttribute("aria-label");
    categoryPicker.style.cssText = "width:100%;border:1px solid #cbd5e1;border-radius:10px;background:#fff;padding:8px;font-size:12px;font-weight:800;color:#334155";
    categoryPicker.addEventListener("change", () => {
      categoryMenu.value = categoryPicker.value;
      categoryMenu.dispatchEvent(new Event("change", { bubbles: true }));
    });
    categoryMenu.addEventListener("change", () => { categoryPicker.value = categoryMenu.value; });
    panel.prepend(categoryPicker);
    return true;
  };
  setTimeout(setupFilterBar, 1400);
  setInterval(setupFilterBar, 30000);
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
  const nySessionStatus = () => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date());
    const value = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const minutes = Number(value.hour) * 60 + Number(value.minute);
    const isWeekday = !["Sat", "Sun"].includes(value.weekday);
    return isWeekday && minutes >= 570 && minutes < 960 ? "미국 장중" : "미국 장 마감";
  };

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
    freshness.textContent = `${nySessionStatus()} · 갱신 ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}`;

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

  const metricText = (label) => {
    const labelNode = [...document.querySelectorAll("div")].find((node) => node.textContent.trim() === label);
    const metricCard = labelNode?.parentElement;
    return metricCard?.querySelector(".text-xl")?.textContent?.trim() || "-";
  };

  const setupDetailSummary = () => {
    const chart = document.querySelector('[aria-label$="볼린저밴드 차트"]');
    if (!chart) return;
    const symbol = chart.getAttribute("aria-label")?.replace(/ 볼린저밴드 차트$/, "") || "선택 종목";
    const card = [...document.querySelectorAll(".market-compact-card")].find((item) => item.textContent.includes(symbol));
    const status = card?.querySelector("[data-signal-status]")?.textContent?.trim() || "신호 확인 중";
    const detail = card?.querySelector("[data-signal-reason]")?.dataset.reasonDetail || "지표를 확인 중입니다.";
    const reason = detail.split(" · ").slice(1, 3).join(" · ") || detail;
    const lower = metricText("하단까지");
    const upper = metricText("상단까지");
    const host = chart.parentElement;
    if (!host) return;
    let summary = host.parentElement?.querySelector("[data-detail-summary]");
    if (!summary) {
      summary = document.createElement("section");
      summary.dataset.detailSummary = "";
      summary.style.cssText = "display:grid;gap:6px;margin:0 0 12px;padding:12px 14px;border:1px solid #dbeafe;border-radius:14px;background:linear-gradient(135deg,#f8fbff,#fff);color:#0f172a";
      host.before(summary);
    }
    summary.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px"><strong style="font-size:14px">${symbol} 한눈에 보기</strong><span style="border-radius:999px;background:#e2e8f0;padding:4px 8px;color:#334155;font-size:12px;font-weight:900">${status}</span></div><div style="font-size:13px;font-weight:750;color:#475569">핵심 흐름 · ${reason}</div><div style="font-size:13px;font-weight:750;color:#475569">주의 가격대 · BB 하단 ${lower} / 상단 ${upper}</div>`;
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
    const chartText = chart.closest(".min-w-0")?.innerText || "";
    const levels = [
      { key: "1차", color: "#2563eb", value: Number(chartText.match(/1차\s*\$([\d,.]+)/)?.[1]?.replace(/,/g, "")) },
      { key: "2차", color: "#7c3aed", value: Number(chartText.match(/2차\s*\$([\d,.]+)/)?.[1]?.replace(/,/g, "")) },
      { key: "주의", color: "#e11d48", value: Number(chartText.match(/주의\s*\$([\d,.]+)/)?.[1]?.replace(/,/g, "")) },
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

  const setupTodayReason = () => {
    const board = [...document.querySelectorAll("button")].find((button) => button.textContent.includes("SIGNAL BOARD · M7 & MARKET"));
    if (!board) return;
    const cards = [...document.querySelectorAll(".market-compact-card")];
    const card = cards.find((item) => [...item.querySelectorAll("strong,div")].some((node) => /^[A-Z.]{1,6}$/.test(node.textContent.trim()) && board.textContent.includes(node.textContent.trim())));
    if (!card) return;
    const status = card.querySelector("[data-signal-status]")?.textContent?.trim();
    const reason = card.querySelector("[data-signal-reason-text]")?.textContent?.replace(/^\s*·\s*/, "").trim();
    if (!status || !reason) return;
    let note = board.querySelector("[data-today-reason]");
    if (!note) {
      note = document.createElement("span");
      note.dataset.todayReason = "";
      note.style.cssText = "display:block;margin-top:4px;color:#94a3b8;font-size:10px;font-weight:800";
      board.append(note);
    }
    note.textContent = `선정 포인트 · ${status} / ${reason}`;
  };

  const enhanceDashboard = () => {
    setupMarketTape();
    setupDetailSummary();
    setupChartGuides();
    setupTodayReason();
  };
  setTimeout(enhanceDashboard, 2200);
  setTimeout(enhanceDashboard, 6000);
  setInterval(enhanceDashboard, 5000);
})();

/* Replace the always-visible ticker tools with a compact, optional daily focus panel. */
(() => {
  const tickerOf = (card) => card.querySelector("img[alt$=' logo']")?.alt?.replace(/ logo$/, "") || "종목";
  const scoreOf = (card) => Number(card.querySelector("[data-compact-insight]")?.getAttribute("aria-label")?.match(/점수 (\d+)점/)?.[1] || 0);
  const bandOf = (card) => {
    const text = card.querySelector("[data-compact-insight]")?.textContent || "";
    const match = text.match(/BB 하단까지 ([\d.]+)%/);
    return match ? Number(match[1]) : (text.includes("BB 하단 이탈") ? 0 : 99);
  };

  const refreshFocusCards = (list) => {
    const candidates = [...document.querySelectorAll("button.market-compact-card")]
      .map((card) => ({ card, ticker: tickerOf(card), score: scoreOf(card), band: bandOf(card) }))
      .filter((item) => item.score > 0 && item.band < 99)
      .sort((a, b) => ((a.band * 5) - a.score * .3) - ((b.band * 5) - b.score * .3))
      .slice(0, 5);
    list.replaceChildren(...candidates.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;border:1px solid #dbe4f0;border-radius:10px;background:#fff;padding:10px 11px;color:#1e293b;text-align:left;cursor:pointer";
      const ticker = document.createElement("strong");
      ticker.textContent = item.ticker;
      ticker.style.cssText = "min-width:48px;font-size:13px;font-weight:950;letter-spacing:.02em";
      const metrics = document.createElement("span");
      metrics.style.cssText = "display:flex;align-items:center;justify-content:flex-end;gap:6px;flex-wrap:wrap";
      const score = document.createElement("span");
      score.textContent = `점수 ${item.score}`;
      score.style.cssText = "border-radius:999px;background:#e0f2fe;color:#0369a1;padding:4px 7px;font-size:10px;font-weight:900;white-space:nowrap";
      const band = document.createElement("span");
      band.textContent = item.band === 0 ? "BB 하단 이탈" : `BB 하단 ${item.band.toFixed(1)}%`;
      band.style.cssText = `border-radius:999px;background:${item.band <= 1 ? "#fef3c7" : "#f1f5f9"};color:${item.band <= 1 ? "#92400e" : "#475569"};padding:4px 7px;font-size:10px;font-weight:900;white-space:nowrap`;
      metrics.append(score, band);
      button.append(ticker, metrics);
      button.addEventListener("click", () => item.card.click());
      return button;
    }));
  };

  const setupDailyFocus = () => {
    const input = document.querySelector('input[aria-label*="관심종목"]');
    const refresh = [...document.querySelectorAll("button")].find((button) => button.textContent.trim().includes("새로고침"));
    if (!input || !refresh) return false;
    let focus = document.querySelector("[data-daily-focus]");
    if (focus) {
      const list = focus.querySelector("[data-daily-focus-list]");
      if (list && focus.dataset.open === "true") refreshFocusCards(list);
      return true;
    }
    const tools = input.parentElement;
    if (!tools) return false;
    focus = document.createElement("section");
    focus.dataset.dailyFocus = "";
    focus.dataset.open = "false";
    focus.style.cssText = "width:100%;max-width:580px;margin:0 0 10px";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.textContent = "오늘의 5종목  ▾";
    toggle.style.cssText = "width:100%;border:1px solid #cbd5e1;border-radius:12px;background:#fff;padding:11px 13px;color:#0f172a;font-size:13px;font-weight:950;text-align:left;cursor:pointer;box-shadow:0 1px 2px rgba(15,23,42,.04)";
    const panel = document.createElement("div");
    panel.hidden = true;
    panel.style.cssText = "margin-top:8px;border:1px solid #dbe4f0;border-radius:12px;background:#f8fafc;padding:10px";
    const title = document.createElement("div");
    title.textContent = "BB 하단 거리와 신호 점수를 기준으로 정리한 오늘의 후보입니다.";
    title.style.cssText = "margin:2px 2px 9px;color:#64748b;font-size:11px;font-weight:800;line-height:1.4";
    const list = document.createElement("div");
    list.dataset.dailyFocusList = "";
    list.style.cssText = "display:flex;flex-direction:column;gap:6px";
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid #e2e8f0";
    const anchor = tools.parentElement;
    tools.style.flex = "1";
    input.style.minWidth = "0";
    refresh.style.whiteSpace = "nowrap";
    actions.append(tools, refresh);
    panel.append(title, list, actions);
    toggle.addEventListener("click", () => {
      const open = panel.hidden;
      panel.hidden = !open;
      focus.dataset.open = String(open);
      toggle.textContent = open ? "오늘의 5종목  ▴" : "오늘의 5종목  ▾";
      if (open) refreshFocusCards(list);
    });
    focus.append(toggle, panel);
    if (anchor) anchor.prepend(focus);
    return true;
  };
  setTimeout(setupDailyFocus, 2200);
  setInterval(setupDailyFocus, 30000);
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
    if (!Number.isFinite(Number(value))) return "데이터 대기";
    const text = Number(value).toLocaleString("en-US", { minimumFractionDigits: item.digits, maximumFractionDigits: item.digits });
    return text;
  };
  const movement = (change) => {
    if (!Number.isFinite(Number(change))) return { text: "—", color: "#64748b", background: "#f1f5f9" };
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
  const sectorSymbols = new Set(sectors.flatMap((sector) => sector.symbols));
  const sectorTicker = (card) => {
    const logoTicker = card.querySelector("img[alt$=' logo']")?.alt?.replace(/ logo$/, "");
    if (logoTicker) return logoTicker;
    return (card.textContent.match(/\b[A-Z][A-Z.]{0,5}\b/g) || []).find((ticker) => sectorSymbols.has(ticker)) || "";
  };
  const sectorChange = (card) => Number(card.textContent.match(/([+-]\d+(?:\.\d+)?)%/)?.[1] || 0);

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
      const averageChange = group.length
        ? group.reduce((total, card) => total + sectorChange(card), 0) / group.length
        : null;
      const state = averageChange == null
        ? { symbol: "—", label: "해당 없음", color: "#94a3b8", bg: "#f1f5f9" }
        : averageChange >= .5
          ? { symbol: "▲", label: "강세", color: "#047857", bg: "#d1fae5" }
          : averageChange <= -.5
            ? { symbol: "▼", label: "약세", color: "#be123c", bg: "#ffe4e6" }
            : { symbol: "■", label: "보합", color: "#475569", bg: "#e2e8f0" };
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = `${sector.name} ${state.symbol} ${state.label}`;
      button.title = averageChange == null
        ? `${sector.name} 섹터 종목은 현재 TOP50에 없습니다.`
        : `${sector.name} 대표 종목 평균 ${averageChange >= 0 ? "+" : ""}${averageChange.toFixed(1)}%`;
      button.disabled = !group.length;
      button.style.cssText = `min-width:0;min-height:38px;border:0;border-radius:9px;background:${state.bg};color:${state.color};padding:7px 6px;font-size:10px;font-weight:950;line-height:1.15;cursor:${group.length ? "pointer" : "not-allowed"};white-space:normal;text-align:center;opacity:${group.length ? "1" : ".72"}`;
      button.addEventListener("click", () => {
        cards.forEach((card) => { card.style.display = sector.symbols.includes(sectorTicker(card)) ? "" : "none"; });
      });
      flow.append(button);
    });
    const radarTitle = [...document.querySelectorAll("*")].find((element) => element.textContent.trim() === "MARKET CAP RADAR");
    const capTitle = [...document.querySelectorAll("*")].find((element) => element.textContent.trim() === "미국 시총 TOP50");
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
      titleStack.innerHTML = '<span style="font-size:10px;font-weight:950;letter-spacing:.1em;color:#64748b">MARKET CAP RADAR</span><strong style="font-size:18px;font-weight:950;color:#0f172a">미국 시총 TOP50</strong>';
      compactHeader.append(titleStack, flow);
      description.before(compactHeader);
      flow.style.margin = "0";
    } else {
      if (!compactHeader.contains(flow)) compactHeader.append(flow);
      flow.style.margin = "0";
    }
    [radarTitle, capTitle, description].filter(Boolean).forEach((element) => { element.style.display = "none"; });
    return true;
  };
  setTimeout(setupSectorFlow, 0);
  setInterval(setupSectorFlow, 1000);
})();

/* Android-ready notification permission and a user-triggered delivery test. */
(() => {
  const supported = "serviceWorker" in navigator && "Notification" in window;
  const showToast = (message) => {
    const toast = document.createElement("div");
    toast.setAttribute("role", "status");
    toast.textContent = message;
    toast.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:61;max-width:260px;border-radius:12px;padding:10px 13px;background:#0f172a;color:#fff;font-size:12px;font-weight:800;box-shadow:0 10px 24px rgba(15,23,42,.25);transition:opacity .25s";
    document.body.append(toast);
    setTimeout(() => { toast.style.opacity = "0"; setTimeout(() => toast.remove(), 250); }, 2800);
  };
  const buildControl = () => {
    if (document.querySelector("[data-notification-control]") || (supported && Notification.permission === "granted")) return;
    const control = document.createElement("button");
    control.type = "button";
    control.dataset.notificationControl = "";
    control.setAttribute("aria-label", "안드로이드 알림 켜기");
    control.title = "안드로이드 알림 켜기";
    control.textContent = "🔔";
    control.style.cssText = "position:fixed;right:14px;bottom:14px;z-index:60;width:42px;height:42px;border:0;border-radius:50%;background:#0f172a;color:#fff;font-size:18px;box-shadow:0 10px 24px rgba(15,23,42,.25);cursor:pointer";
    control.addEventListener("click", async () => {
      if (!supported) { control.remove(); return showToast("이 브라우저는 알림을 지원하지 않습니다."); }
      if (Notification.permission === "denied") { control.remove(); return showToast("알림은 브라우저 설정에서 허용할 수 있습니다."); }
      try {
        const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
        if (permission !== "granted") return showToast("알림 권한이 허용되지 않았습니다.");
        await navigator.serviceWorker.register("./sw.js");
        const ready = await navigator.serviceWorker.ready;
        await ready.showNotification("NASDAQ Watchlist", {
          body: "안드로이드 알림 테스트가 정상적으로 도착했습니다.",
          tag: "nasdaq-watchlist-test",
          renotify: true,
          data: { url: "/" }
        });
        showToast("알림 권한이 등록되었습니다.");
      } catch (_) {
        showToast("알림 설정을 완료하지 못했습니다.");
      } finally {
        control.remove();
      }
    });
    document.body.append(control);
  };
  window.addEventListener("load", () => setTimeout(buildControl, 500), { once: true });
})();
