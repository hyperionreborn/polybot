const axios = require("axios");

/**
 * Market discovery for Polymarket BTC Up/Down 5-min and 15-min markets.
 *
 * These markets use predictable slugs based on epoch-aligned window starts:
 *   - 5-min:  btc-updown-5m-{epochSec}
 *   - 15-min: btc-updown-15m-{epochSec}
 *
 * We compute the current and upcoming window epochs, then fetch each event
 * by its exact slug from the Gamma API /events endpoint.
 *
 * Outcomes are "Up" / "Down" (not Yes/No). The market resolves "Up" if BTC
 * price at window end >= price at window start (per Chainlink oracle).
 */

const WINDOW_CONFIGS = [
  { label: "5m", seconds: 300, slugPrefix: "btc-updown-5m" },
  { label: "15m", seconds: 900, slugPrefix: "btc-updown-15m" },
];

class MarketDiscovery {
  constructor(gammaUrl, intervalMs) {
    this.gammaUrl = gammaUrl;
    this.intervalMs = intervalMs;
    this.timer = null;
    this.markets = [];
  }

  start(onUpdate) {
    this.onUpdate = onUpdate;
    this._poll();
    this.timer = setInterval(() => this._poll(), this.intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async _poll() {
    const nowSec = Math.floor(Date.now() / 1000);
    const slugs = [];

    for (const cfg of WINDOW_CONFIGS) {
      const currentWindowStart = nowSec - (nowSec % cfg.seconds);
      // Fetch current, next, and previous windows to cover edge cases
      for (let offset = -1; offset <= 2; offset++) {
        const epoch = currentWindowStart + offset * cfg.seconds;
        slugs.push({
          slug: `${cfg.slugPrefix}-${epoch}`,
          windowLabel: cfg.label,
          windowSeconds: cfg.seconds,
          windowStart: epoch * 1000,
          windowEnd: (epoch + cfg.seconds) * 1000,
        });
      }
    }

    const results = await Promise.allSettled(
      slugs.map((s) => this._fetchEvent(s))
    );

    const newMarkets = [];
    for (const result of results) {
      if (result.status === "fulfilled" && result.value) {
        newMarkets.push(result.value);
      }
    }

    // Deduplicate by id, keep only active & accepting orders
    const seen = new Set();
    this.markets = newMarkets.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return m.active && m.acceptingOrders;
    });

    // Sort by resolution time (soonest first)
    this.markets.sort((a, b) => a.resolutionTime - b.resolutionTime);

    if (this.onUpdate) this.onUpdate(this.markets);
  }

  async _fetchEvent(slugInfo) {
    try {
      const { data } = await axios.get(this.gammaUrl, {
        params: { slug: slugInfo.slug },
      });

      const events = Array.isArray(data) ? data : [];
      if (!events.length) return null;

      const event = events[0];
      const market = (event.markets || [])[0];
      if (!market) return null;

      return this._normalize(event, market, slugInfo);
    } catch (err) {
      // 404 or not found is normal for future windows not yet created
      if (err.response && err.response.status === 404) return null;
      // Only log unexpected errors
      if (!err.message.includes("404")) {
        console.error(`[MARKETS] Fetch error for ${slugInfo.slug}:`, err.message);
      }
      return null;
    }
  }

  _normalize(event, market, slugInfo) {
    // Parse clobTokenIds — stringified JSON array
    let tokenIds = [];
    try {
      tokenIds = JSON.parse(market.clobTokenIds || "[]");
    } catch {}

    // Parse outcomes — stringified JSON array: ["Up", "Down"]
    let outcomes = [];
    try {
      outcomes = JSON.parse(market.outcomes || "[]");
    } catch {}

    // Parse outcome prices
    let outcomePrices = [];
    try {
      outcomePrices = JSON.parse(market.outcomePrices || "[]").map(Number);
    } catch {}

    // Map token IDs to outcomes
    const upIdx = outcomes.findIndex((o) => o.toLowerCase() === "up");
    const downIdx = outcomes.findIndex((o) => o.toLowerCase() === "down");

    const upTokenId = upIdx >= 0 && tokenIds[upIdx] ? tokenIds[upIdx] : "";
    const downTokenId = downIdx >= 0 && tokenIds[downIdx] ? tokenIds[downIdx] : "";

    const upPrice = upIdx >= 0 ? outcomePrices[upIdx] || null : null;
    const downPrice = downIdx >= 0 ? outcomePrices[downIdx] || null : null;

    // eventStartTime is the window start; endDate is the resolution time
    const windowStart = event.startTime
      ? new Date(event.startTime).getTime()
      : slugInfo.windowStart;

    const resolutionTime = market.endDate
      ? new Date(market.endDate).getTime()
      : slugInfo.windowEnd;

    return {
      id: market.id,
      eventId: event.id,
      conditionId: market.conditionId || "",
      question: market.question || event.title || "",
      slug: event.slug || slugInfo.slug,
      windowLabel: slugInfo.windowLabel,

      // Timing
      windowStart,
      resolutionTime,

      // No strike — these are "up or down from window start" markets
      strike: null,
      startPrice: null, // Will be filled by store when we capture BTC at window start

      // Token IDs for CLOB
      upTokenId,
      downTokenId,

      // Prices (from Gamma snapshot, will be overwritten by orderbook poller)
      upAsk: upPrice,
      downAsk: downPrice,
      combined: upPrice && downPrice ? parseFloat((upPrice + downPrice).toFixed(4)) : null,

      // Market state
      active: market.active !== false,
      acceptingOrders: market.acceptingOrders !== false,
      volume: market.volumeNum || 0,
      liquidity: market.liquidityNum || 0,
    };
  }
}

module.exports = MarketDiscovery;
