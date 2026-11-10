import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../watchlist-data.js", import.meta.url), "utf8");
const pages = "https://esp6662266.github.io/nasdaq-watchlist/";
const netlify = "https://nasdaq-watchlist-0520214351.netlify.app";

function load(location) {
  const calls = [];
  const window = {
    async fetch(input, options) {
      calls.push({ input, options });
      return Response.json({ quotes: { "BRK-B": { close: 500 } } });
    },
  };
  runInNewContext(source, { window, location: new URL(location), URL, Request });
  return { window, calls };
}

test("Pages uses the Netlify data API while keeping the page and credentials on the original origin", async () => {
  const { window, calls } = load(pages);
  await window.fetch("/api/quotes?symbols=BRK.B");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0].input, `${netlify}/api/quotes?symbols=BRK.B`);
  assert.equal(calls[0].options.credentials, "omit");
  assert.equal(window.NasdaqWatchlistData.quote("BRK.B").data.close, 500);
  await window.fetch("/api/earnings?symbols=NVDA");
  assert.equal(calls[1].input, `${netlify}/api/earnings?symbols=NVDA`);
  await window.fetch("https://other.example/api/quotes");
  assert.equal(calls[2].input, "https://other.example/api/quotes");
});

test("Netlify continues to use its same-origin APIs", async () => {
  const { window, calls } = load(netlify);
  await window.fetch("/api/history?symbols=AAPL");
  assert.equal(calls[0].input, "/api/history?symbols=AAPL");
});
