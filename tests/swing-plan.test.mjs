import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const window = {};
runInNewContext(readFileSync(new URL("../swing-plan.js", import.meta.url), "utf8"), { window });
const { analyze } = window.NasdaqSwingPlan;

const dates = Array.from({ length: 51 }, (_, index) => new Date(Date.UTC(2026, 9, index - 16)))
  .filter((date) => date.getUTCDay() !== 0 && date.getUTCDay() !== 6)
  .map((date) => date.toISOString().slice(0, 10));
const priorCandles = dates.filter((date) => date < "2026-11-03").map((time, index, priorDates) =>
  index < priorDates.length - 6
    ? { time, low: 109, high: 111, close: 110, volume: 100 }
    : { time, low: 99, high: 101, close: 100, volume: 100 },
);
const breakout = { time: "2026-11-03", low: 100, high: 103, close: 102, volume: 100 };
const inputs = {
  symbol: "TEST",
  rows: [...priorCandles, breakout],
  historyUsable: true,
  quoteUsable: true,
  earnings: { verified: true, soon: false },
  now: new Date("2026-11-03T22:00:00Z"),
};

test("a gap through the prior stop is detected without using the evaluation candle's low", () => {
  const gapDown = { ...breakout, low: 93, high: 97, close: 94 };
  const { plan, comment, alerts } = analyze({ ...inputs, rows: [...priorCandles, gapDown] });

  assert.equal(plan.referenceDate, "2026-11-02");
  assert.equal(plan.evaluationDate, "2026-11-03");
  assert.equal(plan.stopValue, 99);
  assert.equal(comment.tier, "watch");
  assert.equal(alerts[0].key, "TEST-2026-11-03-stop");
});

test("today's daily candle enters evaluation after the New York closing hour", () => {
  const intraday = analyze({ ...inputs, now: new Date("2026-11-03T20:59:00Z") });
  const intradayWithoutCandle = analyze({ ...inputs, rows: priorCandles, now: new Date("2026-11-03T20:59:00Z") });
  const afterClose = analyze(inputs);

  assert.equal(intraday.session.inProgress, true);
  assert.equal(intraday.plan.evaluationDate, null);
  assert.equal(intraday.alerts.length, 0);
  assert.equal(afterClose.session.inProgress, false);
  assert.equal(afterClose.plan.evaluationDate, "2026-11-03");
  assert.equal(afterClose.comment.tier, "entry");
  assert.equal(intraday.plan.referenceDate, afterClose.plan.referenceDate);
  assert.equal(intraday.plan.stopValue, afterClose.plan.stopValue);
  assert.equal(intraday.plan.targetValue, afterClose.plan.targetValue);
  assert.equal(intradayWithoutCandle.plan.stopValue, afterClose.plan.stopValue);
  assert.equal(intradayWithoutCandle.alerts.length, 0);
});

test("unverified earnings block confirmation and stale prices suppress price alerts", () => {
  const unverified = analyze({ ...inputs, earnings: { verified: false, soon: false } });
  const stale = analyze({ ...inputs, historyUsable: false });

  assert.equal(unverified.comment.tier, "watch");
  assert.match(unverified.comment.reasons.join(" "), /실적 일정이 확인되지 않았습니다/);
  assert.equal(stale.comment.tier, "watch");
  assert.equal(stale.alerts.length, 0);
});
