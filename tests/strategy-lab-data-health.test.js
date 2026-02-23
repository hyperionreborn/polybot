const test = require("node:test");
const assert = require("node:assert/strict");
const Store = require("../server/store");
const config = require("../server/config");
const StrategyLabEngine = require("../server/strategy-lab/engine");

test("strategy lab data health reports stale when timestamps old", () => {
  const store = new Store(config.defaults);
  const engine = new StrategyLabEngine(store, null, { gammaApi: config.gammaApi, tickMs: 1000 });
  const preset = engine.createPreset({ name: "Health", category: "btc5m", startingCash: 1000 });
  const now = Date.now();
  preset.lastMarketAt = now - 9000;
  preset.lastPriceAt = now - 7000;
  const health = engine._refreshDataHealth(preset, now);
  assert.equal(health.status, "Stale");
});
