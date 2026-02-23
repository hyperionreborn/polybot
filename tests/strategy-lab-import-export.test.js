const test = require("node:test");
const assert = require("node:assert/strict");
const Store = require("../server/store");
const config = require("../server/config");
const StrategyLabEngine = require("../server/strategy-lab/engine");

test("strategy lab export/import roundtrip works", () => {
  const store = new Store(config.defaults);
  const engine = new StrategyLabEngine(store, null, { gammaApi: config.gammaApi, tickMs: 1000 });
  engine.createPreset({ name: "A", category: "btc5m", startingCash: 1000 });
  const exported = engine.exportPresets();
  assert.equal(exported.presets.length, 1);

  const store2 = new Store(config.defaults);
  const engine2 = new StrategyLabEngine(store2, null, { gammaApi: config.gammaApi, tickMs: 1000 });
  const status = engine2.importPresets(exported, { mode: "replace" });
  assert.equal(status.presets.length, 1);
  assert.equal(status.presets[0].name, "A");
  assert.equal(status.presets[0].category, "btc5m");
});
