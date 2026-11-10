(() => {
  const marketClock = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const formatPrice = (value) => `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const average = (values) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const deviation = (values, center) => Math.sqrt(average(values.map((value) => (value - center) ** 2)));
  const asPrice = (value) => Number(value) > 0 && Number.isFinite(Number(value)) ? Number(value) : null;

  function regularMarketSession(now) {
    const parts = Object.fromEntries(marketClock.formatToParts(now).map(({ type, value }) => [type, value]));
    const minutes = Number(parts.hour) * 60 + Number(parts.minute);
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      complete: minutes >= 960,
      open: !["Sat", "Sun"].includes(parts.weekday) && minutes >= 570 && minutes < 960,
    };
  }

  function completedCandles(rows, marketSession) {
    const byDate = new Map();
    for (const row of rows || []) {
      const close = asPrice(row?.close);
      if (!close || !/^\d{4}-\d{2}-\d{2}$/.test(row?.time) || row.time > marketSession.date) continue;
      const high = asPrice(row.high) ?? close;
      const low = asPrice(row.low) ?? close;
      if (low > close || close > high) continue;
      byDate.set(row.time, { ...row, close, high, low });
    }
    const sorted = [...byDate.values()].sort((a, b) => a.time.localeCompare(b.time));
    const unfinishedCandle = !marketSession.complete && sorted.at(-1)?.time === marketSession.date;
    const inProgress = !marketSession.complete && (unfinishedCandle || marketSession.open === true);
    const completed = unfinishedCandle ? sorted.slice(0, -1) : sorted;
    if (!inProgress && !completed.length) {
      return {
        completed,
        session: { inProgress: false, label: "완료 일봉 미확인", detail: "사용할 수 있는 완료 일봉이 없습니다.", color: "#64748b", background: "#f1f5f9" },
      };
    }
    return {
      completed,
      session: inProgress
        ? { inProgress: true, label: "장중 일봉 · 종가 미확정", detail: "스윙 계획은 완료된 일봉으로 계산합니다. 오늘 일봉의 종가는 아직 확정되지 않았습니다.", color: "#a16207", background: "#fef3c7" }
        : { inProgress: false, label: "완료 일봉 기준", detail: "가장 최근 완료 일봉 기준으로 계산했습니다.", color: "#166534", background: "#dcfce7" },
    };
  }

  function makePlan(reference, evaluation) {
    if (reference.length < 6) return null;

    // Fix all levels using information available before the evaluation candle.
    const entry = reference.at(-1).high;
    const stop = Math.min(...reference.slice(-6).map((row) => row.low));
    const risk = entry - stop;
    if (risk <= 0) return null;

    const resistanceRows = reference.slice(-20);
    const closes = resistanceRows.map((row) => row.close);
    const center = average(closes);
    const targets = resistanceRows.length === 20 ? [
      { value: Math.max(...resistanceRows.map((row) => row.high)), source: "20일 고점" },
      { value: center + 2 * deviation(closes, center), source: "BB 상단" },
    ].filter((candidate) => Number.isFinite(candidate.value) && candidate.value > entry * 1.002).sort((a, b) => a.value - b.value) : [];
    const target = targets[0] || null;
    const ratio = target ? (target.value - entry) / risk : null;
    return {
      entry: formatPrice(entry),
      entryValue: entry,
      stop: formatPrice(stop),
      stopValue: stop,
      target: target ? formatPrice(target.value) : "저항 확인 필요",
      targetValue: target?.value ?? null,
      targetSource: target?.source || "목표 미확정",
      ratio: ratio == null ? "—" : `${ratio.toFixed(1)}R`,
      ratioValue: ratio,
      ratioColor: ratio != null && ratio >= 2 ? "#0369a1" : "#be123c",
      referenceDate: reference.at(-1).time,
      evaluationDate: evaluation?.time ?? null,
      latestClose: evaluation?.close ?? null,
      detail: `${reference.at(-1).time} 완료 일봉까지의 기준 · 고점 ${formatPrice(entry)} 돌파 확인 · 직전 6거래일 저점 ${formatPrice(stop)} 이탈 시 무효 · 목표 ${target?.source || "미확정"}`,
    };
  }

  function classifySetup(rows) {
    const recent = rows.slice(-60);
    if (recent.length < 22) {
      return { label: "셋업 대기", detail: "일봉 데이터가 충분하지 않아 패턴을 분류하지 않습니다.", color: "#64748b", background: "#f1f5f9" };
    }
    const closes = recent.map((row) => row.close);
    const last = closes.at(-1);
    const prior = closes.at(-2);
    const recentCloses = closes.slice(-20);
    const sma20 = average(recentCloses);
    const sma50 = average(closes.slice(recent.length >= 50 ? -50 : -30));
    const spread = deviation(recentCloses, sma20);
    const bbPosition = spread ? (last - (sma20 - 2 * spread)) / (4 * spread) : 0.5;
    const previousTenHigh = Math.max(...recent.slice(-11, -1).map((row) => row.high));
    const previousFiveHigh = Math.max(...recent.slice(-6, -1).map((row) => row.high));
    const volumes = recent.slice(-21, -1).map((row) => Number(row.volume)).filter((value) => Number.isFinite(value) && value > 0);
    const latestVolume = Number(recent.at(-1).volume);
    const volumeRatio = volumes.length && Number.isFinite(latestVolume) && latestVolume > 0 ? latestVolume / average(volumes) : null;

    if (last > previousTenHigh * 1.001 && (volumeRatio == null || volumeRatio >= 1.15)) {
      return { label: "박스 돌파", detail: "최근 10일 고점 돌파와 거래량 확인 구간입니다.", color: "#0369a1", background: "#e0f2fe" };
    }
    if (last > sma20 && sma20 >= sma50 && last < previousFiveHigh && last >= prior) {
      return { label: "추세 눌림목", detail: "상승 추세 안에서 눌림 뒤 반등 확인을 보는 구간입니다.", color: "#1d4ed8", background: "#dbeafe" };
    }
    if (bbPosition <= 0.3 && last >= prior) {
      return { label: "하단 반등", detail: "볼린저밴드 하단권의 반등 시도입니다.", color: "#0369a1", background: "#e0f2fe" };
    }
    if (last < sma20 && sma20 < sma50) {
      return { label: "추세 이탈", detail: "단기와 중기 추세가 모두 약해 신규 진입보다 관찰이 우선입니다.", color: "#be123c", background: "#ffe4e6" };
    }
    return { label: "셋업 대기", detail: "현재는 진입 패턴이 뚜렷하지 않아 방향 확인이 필요합니다.", color: "#475569", background: "#e2e8f0" };
  }

  function evaluate(plan, setup, session, earnings, historyUsable, quoteUsable) {
    const setupValid = ["추세 눌림목", "하단 반등", "박스 돌파"].includes(setup.label);
    const earningsVerified = earnings?.verified === true && typeof earnings.soon === "boolean";
    const earningsSoon = earnings?.soon === true;
    const hasEvaluation = plan?.evaluationDate != null;
    const stopBreached = hasEvaluation && plan.latestClose < plan.stopValue;
    const targetReached = hasEvaluation && plan.targetValue != null && plan.latestClose >= plan.targetValue;
    const reasons = [
      !historyUsable && "완료 일봉의 최신 상태를 확인하지 못했습니다.",
      !quoteUsable && "시세의 최신 상태를 확인하지 못했습니다.",
      !earningsVerified && "실적 일정이 확인되지 않았습니다.",
      earningsSoon && `${earnings.label || "실적 발표"} 일정이 임박했습니다.`,
      session.inProgress && "오늘 일봉의 종가 확정을 기다립니다.",
      !plan && "계획을 계산할 완료 일봉이 부족합니다.",
      stopBreached && `완료 종가가 무효화 기준 ${plan.stop}을 이탈했습니다.`,
      targetReached && `완료 종가가 1차 목표 ${plan.target}에 도달했습니다.`,
      hasEvaluation && plan.latestClose <= plan.entryValue && !stopBreached && `완료 종가가 진입 기준 ${plan.entry}을 아직 돌파하지 않았습니다.`,
      plan && plan.ratioValue == null && "1차 목표와 계획 손익비를 확인하지 못했습니다.",
      plan && plan.ratioValue != null && plan.ratioValue < 2 && `계획 손익비 ${plan.ratio}가 2R 기준에 못 미칩니다.`,
      !setupValid && `${setup.label} 상태입니다.`,
    ].filter(Boolean);

    if (!reasons.length) {
      return {
        tier: "entry",
        verdict: "규칙상 진입 조건 충족",
        color: "#166534",
        background: "#dcfce7",
        reasons: [`완료 종가가 ${plan.entry}을 돌파했습니다.`, `1차 목표까지 계획 손익비가 ${plan.ratio}입니다.`, `${setup.label} 셋업이며 확인된 임박 실적 일정이 없습니다.`],
      };
    }
    if (historyUsable && quoteUsable && earningsVerified && !earningsSoon && setupValid && plan && !stopBreached && !targetReached) {
      return { tier: "waiting", verdict: "진입 대기", color: "#a16207", background: "#fef3c7", reasons };
    }
    return { tier: "watch", verdict: "관찰", color: "#475569", background: "#e2e8f0", reasons };
  }

  function getAlerts(symbol, plan, earnings, historyUsable, quoteUsable) {
    if (!symbol) return [];
    const alerts = [];
    if (plan?.evaluationDate && historyUsable && quoteUsable) {
      const key = `${symbol}-${plan.evaluationDate}`;
      const close = plan.latestClose;
      if (close < plan.stopValue) {
        alerts.push({ key: `${key}-stop`, symbol, type: "손절 기준 이탈", detail: `${plan.evaluationDate} 완료 종가가 무효화 기준 ${plan.stop}을 이탈했습니다.`, color: "#be123c" });
      } else if (plan.targetValue != null && close >= plan.targetValue) {
        alerts.push({ key: `${key}-target`, symbol, type: "1차 목표 도달", detail: `${plan.evaluationDate} 완료 종가가 ${plan.targetSource} 목표 ${plan.target}에 도달했습니다.`, color: "#166534" });
      } else if (close > plan.entryValue) {
        alerts.push({ key: `${key}-breakout`, symbol, type: "전일 고점 돌파", detail: `${plan.evaluationDate} 완료 종가가 진입 기준 ${plan.entry}을 넘었습니다.`, color: "#1d4ed8" });
      }
    }
    if (earnings?.soon === true && earnings.date) {
      alerts.push({ key: `${symbol}-${earnings.date}-earnings`, symbol, type: earnings.label || "실적 발표 임박", detail: `${earnings.date} 실적 발표 예정입니다.`, color: "#be123c" });
    }
    return alerts;
  }

  function analyze({ symbol, rows, historyUsable = false, quoteUsable = false, earnings, now = new Date(), marketSession = regularMarketSession(now) }) {
    const { completed, session } = completedCandles(rows, marketSession);
    const reference = session.inProgress ? completed : completed.slice(0, -1);
    const evaluation = session.inProgress ? null : completed.at(-1);
    const plan = makePlan(reference, evaluation);
    const setup = classifySetup(completed);
    const comment = evaluate(plan, setup, session, earnings, historyUsable, quoteUsable);
    const alerts = getAlerts(symbol, plan, earnings, historyUsable, quoteUsable);
    return { plan, setup, session, comment, alerts };
  }

  window.NasdaqSwingPlan = { analyze };
})();
