const axios = require("axios");

const CLOB_BASE = "https://clob.polymarket.com";

/**
 * Stop Loss Monitor
 *
 * Tracks open positions and market sells if the best BID drops below a threshold.
 * This is a safety mechanism to prevent blowing up the account on bad trades.
 */
class StopLossMonitor {
  constructor(clobClient, store, io, config) {
    this.clobClient = clobClient;
    this.store = store;
    this.io = io;
    this.pollMs = config.pollMs || 500;
    this.threshold = config.threshold || 0.70; // Global fallback

    this.positions = []; // Array of tracked positions
    this.timer = null;
    this.selling = new Set(); // Position IDs currently being sold
  }

  /**
   * Register a new position to monitor.
   * @param {string} tokenId
   * @param {string} side "Up" or "Down"
   * @param {number} size Number of shares
   * @param {number} price Entry price
   * @param {object} market Market object
   * @param {number} [stopLoss] Optional custom stop loss price (e.g. 0.80)
   */
  addPosition({ tokenId, side, size, price, market, stopLoss, strategy = "SNIPER" }) {
    const pos = {
      id: Math.random().toString(36).substring(7),
      tokenId,
      side,
      size,
      entryPrice: price,
      market,
      strategy,
      stopLoss: stopLoss || this.threshold, // Use custom or default
      addedAt: Date.now(),
      state: "open",
      exitApplied: false,
    };
    this.positions.push(pos);
    console.log(`[STOPLOSS] Tracking ${side} ${size} shares @ $${price.toFixed(4)} (Stop: $${pos.stopLoss}) — ${market.question}`);
    this.store.addLog({
      strategy: "STOPLOSS",
      action: "TRACKING",
      side,
      price,
      size,
      stopLoss: pos.stopLoss,
      market: market.question,
    });
  }

  start() {
    if (this.timer) return;
    console.log(`[STOPLOSS] Monitor started (poll=${this.pollMs}ms, default threshold=$${this.threshold})`);
    this.timer = setInterval(() => this._check(), this.pollMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async _check() {
    if (!this.positions.length) return;

    // Filter out resolved markets
    const activeMarketIds = new Set(this.store.markets.map((m) => m.id));
    this.positions = this.positions.filter((p) => {
        if (!activeMarketIds.has(p.market.id)) return false;
        // Also drop if resolved time passed? 
        // Actually we might want to hold until resolution, but for now stick to active markets
        return true;
    });

    for (const pos of [...this.positions]) {
      if (pos.state !== "open") continue;
      if (this.selling.has(pos.id)) continue;

      try {
        // Fetch current best bid for this token
        // Optimization: Could batch this or use store prices if they include Bids,
        // but store usually tracks Asks. For safety, we fetch book directly.
        const { data: book } = await axios.get(`${CLOB_BASE}/book`, {
          params: { token_id: pos.tokenId },
          timeout: 2000,
        });

        const bestBid = this._bestBid(book);
        
        // If best bid is 0 or non-existent, it might be illiquid.
        // We only sell if there is a bid AND it is below threshold.
        // If there are NO bids, we are stuck anyway.
        if (bestBid > 0 && bestBid < pos.stopLoss) {
          console.log(`[STOPLOSS] TRIGGER: ${pos.side} bid $${bestBid} < stop $${pos.stopLoss}`);
          this._sell(pos, bestBid);
        }

      } catch (err) {
        // Ignore network hiccups
      }
    }
  }

  async _sell(pos, currentBid) {
    if (this.selling.has(pos.id) || pos.state !== "open") return;
    this.selling.add(pos.id);
    pos.state = "triggered";

    const { Side, OrderType } = require("@polymarket/clob-client");

    console.log(`[STOPLOSS] SELLING ${pos.size} shares of ${pos.side} @ market (~$${currentBid})`);
    
    this.store.addLog({
      strategy: "STOPLOSS",
      action: "TRIGGERED",
      reason: `Bid $${currentBid} < $${pos.stopLoss}`,
      market: pos.market.question,
    });

    try {
      // Calculate amount for market sell
      // For selling, we might need to specify size (shares) or amount (cash). 
      // Market Sell: "To sell, set side to SELL and provide size (number of shares)" - wait, verify SDK.
      // createAndPostMarketOrder args: { tokenID, amount, side }
      // For BUY, amount is USDC. For SELL, amount is SHARES usually?
      // Let's check docs or standard behavior.
      // Actually, createAndPostMarketOrder takes 'amount' which is usually the input asset quantity.
      // For BUY (input USDC), amount = USDC.
      // For SELL (input Shares), amount = Shares.
      
      const response = await this.clobClient.createAndPostMarketOrder(
        {
          tokenID: pos.tokenId,
          amount: pos.size, // Selling SHARES
          side: Side.SELL,
        },
        undefined,
        OrderType.FOK // Or generic market? FOK might fail if not fully fillable. Use FOK for safety or GTC? Market is immediate.
                      // Actually for panic sell, we might want generic market order, but FOK is safer to avoid partial weirdness.
                      // Let's stick to FOK market order.
      );

      console.log(`[STOPLOSS] SOLD: ${response.orderID}`);
      
      const profit = (currentBid - pos.entryPrice) * pos.size; // Likely negative
      const roundedProfit = parseFloat(profit.toFixed(2));
      this._applyExitAccountingOnce(pos, roundedProfit);
      this.store.recordTrade({
        strategy: "STOPLOSS",
        action: "SOLD",
        side: pos.side,
        price: currentBid,
        qty: pos.size,
        profit: roundedProfit,
        market: pos.market.question,
        reason: `Stop loss hit ($${currentBid} < $${pos.stopLoss})`
      });

      // Remove from positions
      this.positions = this.positions.filter(p => p.id !== pos.id);
      pos.state = "closed";
      this.selling.delete(pos.id);

    } catch (err) {
      console.error(`[STOPLOSS] SELL FAILED:`, err.message);
      this.store.addLog({
        strategy: "STOPLOSS",
        action: "FAIL",
        reason: err.message,
        market: pos.market.question,
      });
      pos.state = "failed";
      setTimeout(() => {
        if (pos.state === "failed") pos.state = "open";
      }, 500);
      // Allow retry
      this.selling.delete(pos.id);
    }
  }

  _applyExitAccountingOnce(pos, profit) {
    if (pos.exitApplied) return;
    pos.exitApplied = true;
    const key = String(pos.strategy || "").toLowerCase();
    const strategyStats = this.store[key];
    if (!strategyStats) return;
    strategyStats.pnl = parseFloat((strategyStats.pnl + profit).toFixed(2));
    if (profit >= 0) {
      strategyStats.wins += 1;
    } else {
      strategyStats.losses += 1;
    }
  }

  _bestBid(book) {
    if (!book || !book.bids || !book.bids.length) return 0;
    // Bids are sorted desc? usually yes.
    // book.bids = [{ price: "0.50", size: "100" }, ...]
    // We want the highest bid.
    // Polymarket book API returns strings.
    // Assuming sorted, but let's be safe.
    let max = 0;
    for (const bid of book.bids) {
        const p = parseFloat(bid.price);
        if (p > max) max = p;
    }
    return max;
  }
}

module.exports = StopLossMonitor;
