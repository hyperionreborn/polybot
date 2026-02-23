const test = require("node:test");
const assert = require("node:assert/strict");
const SniperStrategy = require("../server/strategies/sniper");

function makeStore() {
  return {
    sniper: {
      enabled: true,
      dryRun: true,
      minPrice: 0.88,
      maxPrice: 0.99,
      betSize: 100,
      buffer: 0.0015,
      windowSec: 40,
      slippage: 0.02,
      cooldown: 0,
      stopLoss: 0.75,
      wins: 0,
      losses: 0,
      pnl: 0,
      status: "Idle",
    },
    addLog() {},
    recordTrade() {},
  };
}

test("sniper places one buy per cycle", async () => {
  const store = makeStore();
  let calls = 0;
  const executor = {
    placeOrder: async () => {
      calls += 1;
      return { success: true, dryRun: true };
    },
  };
  const sniper = new SniperStrategy(store, executor, null);
  const now = Date.now();
  const market = {
    id: "m1",
    slug: "btc-updown-5m-100",
    question: "BTC Up or Down",
    windowLabel: "5m",
    windowStart: now - 10000,
    resolutionTime: now + 20000,
    startPrice: 100000,
    upAsk: 0.91,
    downAsk: 0.08,
    upTokenId: "up-token",
    downTokenId: "down-token",
  };
  sniper.tick([market], 100300, now);
  await new Promise((resolve) => setTimeout(resolve, 0));
  sniper.tick([market], 100320, now + 200);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls, 1);
});
