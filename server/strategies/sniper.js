/**
 * Sniper Strategy
 *
 * In the last N seconds before resolution:
 *   1. Find which side the MARKET says is winning (priced >= minPrice, e.g. $0.90+)
 *   2. Confirm with BTC direction (BTC above/below start price)
 *   3. If both agree → buy
 *
 * This avoids buying a $0.03 side just because BTC dipped 0.2%.
 * Uses Fill-or-Kill market orders.
 */
class SniperStrategy {
  constructor(store, executor, stopLoss) {
    this.store = store;
    this.executor = executor;
    this.stopLoss = stopLoss;
    this.pendingOrders = new Set();
    this.lastFillTimeByCategory = {};
    this.filledMarketIds = new Set();
    this.filledCyclesByCategory = {};
  }

  tick(markets, btcPrice, now) {
    const cfg = this.store.sniper;
    if (!cfg.enabled) {
      cfg.status = "Disabled";
      return;
    }

    cfg.status = "Watching";
    const activeIds = new Set(markets.map((m) => m.id));
    for (const id of [...this.filledMarketIds]) {
      if (!activeIds.has(id)) this.filledMarketIds.delete(id);
    }

    for (const market of markets) {
      if (!market.startPrice || !market.resolutionTime) continue;
      if (this.pendingOrders.has(market.id)) continue;
      // Live sniper is tuned for BTC market direction confirmation only.
      if (!String(market.slug || "").startsWith("btc-updown-")) continue;
      if (this.filledMarketIds.has(market.id)) continue;

      const secsLeft = (market.resolutionTime - now) / 1000;
      if (secsLeft > cfg.windowSec || secsLeft < 0) continue;
      const cycleKey = this._cycleKey(market);
      const category = market.windowLabel || "btc";
      if (this.filledCyclesByCategory[category] === cycleKey) continue;

      // Cooldown is category-scoped and secondary to cycle lock.
      const cooldownMs = (cfg.cooldown || 0) * 1000;
      const lastFillTime = this.lastFillTimeByCategory[category] || 0;
      if (cooldownMs > 0 && (now - lastFillTime) < cooldownMs) {
        cfg.status = `Cooldown ${category} (${Math.ceil((cooldownMs - (now - lastFillTime)) / 1000)}s)`;
        continue;
      }

      // --- Step 1: Which side does the MARKET say is winning? ---
      const minPrice = cfg.minPrice || 0.90;
      const upAsk = market.upAsk;
      const downAsk = market.downAsk;

      let marketSide = null;
      let askPrice = null;

      if (upAsk !== null && upAsk >= minPrice && upAsk <= cfg.maxPrice) {
        marketSide = "Up";
        askPrice = upAsk;
      } else if (downAsk !== null && downAsk >= minPrice && downAsk <= cfg.maxPrice) {
        marketSide = "Down";
        askPrice = downAsk;
      }

      if (!marketSide) {
        // Neither side is priced high enough — no clear winner
        const upStr = upAsk !== null ? `Up $${upAsk.toFixed(4)}` : "Up n/a";
        const downStr = downAsk !== null ? `Down $${downAsk.toFixed(4)}` : "Down n/a";
        // Only log occasionally to avoid spam (every ~3s = every 10th tick at 300ms)
        if (Math.random() < 0.03) {
          this.store.addLog({
            strategy: "SNIPER",
            action: "SKIP",
            reason: `No side >= $${minPrice.toFixed(2)} (${upStr}, ${downStr}) — ${market.question}`,
          });
        }
        continue;
      }

      // --- Step 2: Does BTC direction CONFIRM the market's pick? ---
      const pctDiff = (btcPrice - market.startPrice) / market.startPrice;

      // Buffer check: Is the move significant enough?
      if (Math.abs(pctDiff) < (cfg.buffer || 0.0015)) {
         this.store.addLog({
            strategy: "SNIPER",
            action: "SKIP",
            reason: `Buffer too thin (${(pctDiff * 100).toFixed(3)}% < ${(cfg.buffer * 100).toFixed(3)}%) — ${market.question}`,
         });
         continue;
      }

      const btcConfirms =
        (marketSide === "Up" && pctDiff > 0) ||
        (marketSide === "Down" && pctDiff < 0);

      if (!btcConfirms) {
        this.store.addLog({
          strategy: "SNIPER",
          action: "SKIP",
          reason: `Market says ${marketSide} ($${askPrice.toFixed(4)}) but BTC ${pctDiff >= 0 ? "up" : "down"} ${(pctDiff * 100).toFixed(3)}% — conflicting — ${market.question}`,
        });
        continue;
      }

      // --- Step 3: Calculate order size ---
      let qty = Math.floor(cfg.betSize / askPrice);
      const cost = qty * askPrice;

      if (cost < 1) {
        const minQty = Math.ceil(1.1 / askPrice);
        if (minQty * askPrice <= cfg.betSize * 1.5) {
          qty = minQty;
        } else {
          this.store.addLog({
            strategy: "SNIPER",
            action: "SKIP",
            reason: `Order too small ($${cost.toFixed(2)} < $1 min) — ${market.question}`,
          });
          continue;
        }
      }

      // --- Step 4: Place the order ---
      const tokenId = marketSide === "Up" ? market.upTokenId : market.downTokenId;
      const limitPrice = Math.min(0.99, askPrice + (cfg.slippage || 0.02));

      this.store.addLog({
        strategy: "SNIPER",
        action: "BUY",
        side: marketSide,
        price: askPrice,
        qty,
        market: market.question,
        secsLeft: Math.round(secsLeft),
        startPrice: market.startPrice,
        currentPrice: btcPrice,
      });

      cfg.status = `Buying ${marketSide} @ ${askPrice.toFixed(4)}`;
      this.pendingOrders.add(market.id);

      this.executor
        .placeOrder({
          tokenId,
          side: marketSide,
          price: limitPrice,
          size: qty,
          dryRun: cfg.dryRun,
          strategy: "SNIPER",
          market,
        })
        .then((result) => {
          this.pendingOrders.delete(market.id);
          if (result.success) {
            cfg.wins++;
            const profit = parseFloat(((1 - askPrice) * qty).toFixed(2));
            cfg.pnl += profit;
            this.lastFillTimeByCategory[category] = Date.now();
            this.filledMarketIds.add(market.id);
            this.filledCyclesByCategory[category] = cycleKey;

            if (this.stopLoss && !cfg.dryRun) {
              this.stopLoss.addPosition({ 
                tokenId, 
                side: marketSide, 
                size: qty, 
                price: askPrice, 
                market,
                stopLoss: cfg.stopLoss, // Use configured stop-loss
                strategy: "SNIPER",
              });
            }

            this.store.recordTrade({
              strategy: "SNIPER",
              action: "FILLED",
              side: marketSide,
              price: askPrice,
              qty,
              profit,
              market: market.question,
              dryRun: cfg.dryRun,
            });
          } else {
            this.store.recordTrade({
              strategy: "SNIPER",
              action: "FAILED",
              side: marketSide,
              price: askPrice,
              reason: result.error,
              market: market.question,
              dryRun: cfg.dryRun,
            });
          }
          cfg.status = "Watching";
        })
        .catch(() => {
          this.pendingOrders.delete(market.id);
          cfg.status = "Watching";
        });
    }
  }

  _cycleKey(market) {
    const start = market.windowStart || market.resolutionTime || 0;
    return `${market.windowLabel || "cycle"}-${start}`;
  }
}

module.exports = SniperStrategy;
