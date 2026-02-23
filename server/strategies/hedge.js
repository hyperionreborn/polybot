/**
 * Hedge Strategy
 *
 * Buys Up and Down at different times when each dips cheap,
 * locking profit when combined cost < $1.00.
 * Uses Fill-or-Kill orders.
 */
class HedgeStrategy {
  constructor(store, executor, stopLoss) {
    this.store = store;
    this.executor = executor;
    this.stopLoss = stopLoss;
    this.pending = new Set();
    this.positions = {};
  }

  tick(markets) {
    const cfg = this.store.hedge;
    if (!cfg.enabled) {
      cfg.status = "Disabled";
      return;
    }

    cfg.status = "Watching";

    for (const market of markets) {
      if (!market.upAsk || !market.downAsk) continue;
      if (this.pending.has(market.id)) continue;

      const combined = market.upAsk + market.downAsk;

      if (combined >= cfg.maxCombined) continue;

      const pos = this.positions[market.id] || { upCost: 0, upQty: 0, downCost: 0, downQty: 0 };

      let side = null;
      let askPrice = null;
      let tokenId = null;

      // Buy whichever side is cheaper, keep quantities balanced
      if (market.upAsk <= market.downAsk && market.upAsk <= cfg.maxSinglePrice) {
        if (pos.upQty <= pos.downQty) {
          side = "Up";
          askPrice = market.upAsk;
          tokenId = market.upTokenId;
        }
      }

      if (!side && market.downAsk <= cfg.maxSinglePrice) {
        if (pos.downQty <= pos.upQty) {
          side = "Down";
          askPrice = market.downAsk;
          tokenId = market.downTokenId;
        }
      }

      // Fallback: buy whichever is under maxSinglePrice
      if (!side && market.upAsk <= cfg.maxSinglePrice) {
        side = "Up";
        askPrice = market.upAsk;
        tokenId = market.upTokenId;
      }

      if (!side && market.downAsk <= cfg.maxSinglePrice) {
        side = "Down";
        askPrice = market.downAsk;
        tokenId = market.downTokenId;
      }

      if (!side) {
        this.store.addLog({
          strategy: "HEDGE",
          action: "SKIP",
          reason: `No cheap side (Up ${market.upAsk.toFixed(4)}, Down ${market.downAsk.toFixed(4)}) — ${market.question}`,
        });
        continue;
      }

      let qty = Math.floor(cfg.betSize / askPrice);
      const cost = qty * askPrice;

      if (cost < 1) {
         const minQty = Math.ceil(1.1 / askPrice);
         if (minQty * askPrice <= cfg.betSize * 1.5) {
             qty = minQty;
         } else {
             this.store.addLog({
                strategy: "HEDGE",
                action: "SKIP",
                reason: `Bet size too small ($${cost.toFixed(2)} < $1 min) — increase bet size`,
             });
             continue;
         }
      }

      // Add slippage to limit price
      const limitPrice = Math.min(0.99, askPrice + (cfg.slippage || 0.01));

      this.store.addLog({
        strategy: "HEDGE",
        action: "BUY",
        side,
        price: askPrice,
        qty,
        combined: combined.toFixed(4),
        market: market.question,
      });

      cfg.status = `Buying ${side} @ ${askPrice.toFixed(4)}`;
      this.pending.add(market.id);

      this.executor
        .placeOrder({
          tokenId,
          side,
          price: limitPrice, // Send limit with slippage
          size: qty,
          dryRun: cfg.dryRun,
          strategy: "HEDGE",
          market,
        })
        .then((result) => {
          this.pending.delete(market.id);
          if (result.success) {
            // Register with stop-loss monitor
            if (this.stopLoss && !cfg.dryRun) {
              this.stopLoss.addPosition({
                tokenId,
                side,
                size: qty,
                price: askPrice,
                market,
                strategy: "HEDGE",
              });
            }

            if (side === "Up") {
              pos.upCost += askPrice * qty;
              pos.upQty += qty;
            } else {
              pos.downCost += askPrice * qty;
              pos.downQty += qty;
            }
            this.positions[market.id] = pos;

            // Update aggregate counts
            cfg.upQty = Object.values(this.positions).reduce((s, p) => s + p.upQty, 0);
            cfg.downQty = Object.values(this.positions).reduce((s, p) => s + p.downQty, 0);

            // Calculate locked-in profit from paired positions
            const paired = Math.min(pos.upQty, pos.downQty);
            if (paired > 0) {
              const avgUp = pos.upCost / pos.upQty;
              const avgDown = pos.downCost / pos.downQty;
              const profit = parseFloat(((1 - avgUp - avgDown) * paired).toFixed(2));
              if (profit > 0) {
                cfg.wins++;
                cfg.pnl += profit;
              }
            }

            this.store.recordTrade({
              strategy: "HEDGE",
              action: "FILLED",
              side,
              price: askPrice,
              qty,
              market: market.question,
              dryRun: cfg.dryRun,
            });
          } else {
            this.store.recordTrade({
              strategy: "HEDGE",
              action: "FAILED",
              side,
              reason: result.error,
              market: market.question,
              dryRun: cfg.dryRun,
            });
          }
          cfg.status = "Watching";
        })
        .catch(() => {
          this.pending.delete(market.id);
          cfg.status = "Watching";
        });
    }
  }
}

module.exports = HedgeStrategy;
