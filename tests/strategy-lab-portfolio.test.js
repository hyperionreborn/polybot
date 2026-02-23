const test = require("node:test");
const assert = require("node:assert/strict");
const Store = require("../server/store");
const config = require("../server/config");
const StrategyLabEngine = require("../server/strategy-lab/engine");

test("strategy lab stop loss updates virtual cash once", async () => {
  const store = new Store(config.defaults);
  const engine = new StrategyLabEngine(store, null, { gammaApi: config.gammaApi, tickMs: 1000 });
  const preset = engine.createPreset({ name: "lab", category: "btc5m", startingCash: 1000 });
  preset.cash = 100;
  preset.positions.push({
    id: "p1",
    tokenId: "token",
    side: "Up",
    qty: 10,
    entryPrice: 0.9,
    stopLoss: 0.8,
    state: "open",
  });
  engine._bestBid = async () => 0.7;
  await engine._checkStopLosses(preset);
  assert.equal(preset.cash, 107);
  assert.equal(preset.losses, 1);
  assert.equal(preset.stopLossHits, 1);
  assert.equal(preset.positions[0].state, "closed");
});
