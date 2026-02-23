const test = require("node:test");
const assert = require("node:assert/strict");
const StopLossMonitor = require("../server/stoploss");

test("stoploss accounting applies only once", () => {
  const store = {
    markets: [],
    sniper: { wins: 0, losses: 0, pnl: 0 },
    addLog() {},
    recordTrade() {},
  };
  const monitor = new StopLossMonitor(null, store, null, { pollMs: 500, threshold: 0.7 });
  const pos = { strategy: "SNIPER", exitApplied: false };
  monitor._applyExitAccountingOnce(pos, -12.34);
  monitor._applyExitAccountingOnce(pos, -12.34);
  assert.equal(store.sniper.losses, 1);
  assert.equal(store.sniper.wins, 0);
  assert.equal(store.sniper.pnl, -12.34);
});
