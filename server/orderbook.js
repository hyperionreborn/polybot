const axios = require("axios");

const CLOB_BASE = "https://clob.polymarket.com";

/**
 * Polls CLOB order books for active markets using the public REST API.
 * No authentication required — order books are publicly readable.
 * Attaches best ask prices for Up and Down tokens to each market.
 */
class OrderbookPoller {
  constructor(intervalMs) {
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  start(getMarkets, onUpdate) {
    this.getMarkets = getMarkets;
    this.onUpdate = onUpdate;
    this.timer = setInterval(() => this._poll(), this.intervalMs);
    this._poll();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async _poll() {
    const markets = this.getMarkets();
    if (!markets.length) return;

    // Fetch all order books in parallel for speed
    const fetches = [];

    for (const market of markets) {
      if (market.upTokenId) {
        fetches.push(
          this._fetchBook(market.upTokenId)
            .then((book) => { market.upAsk = this._bestAsk(book); })
            .catch(() => {})
        );
      }
      if (market.downTokenId) {
        fetches.push(
          this._fetchBook(market.downTokenId)
            .then((book) => { market.downAsk = this._bestAsk(book); })
            .catch(() => {})
        );
      }
    }

    await Promise.allSettled(fetches);

    // Recompute combined prices
    for (const market of markets) {
      if (market.upAsk !== null && market.downAsk !== null) {
        market.combined = parseFloat((market.upAsk + market.downAsk).toFixed(4));
      }
    }

    if (this.onUpdate) this.onUpdate(markets);
  }

  async _fetchBook(tokenId) {
    const { data } = await axios.get(`${CLOB_BASE}/book`, {
      params: { token_id: tokenId },
      timeout: 5000,
    });
    return data;
  }

  _bestAsk(book) {
    if (!book || !book.asks || !book.asks.length) return null;
    const sorted = [...book.asks].sort(
      (a, b) => parseFloat(a.price) - parseFloat(b.price)
    );
    return parseFloat(sorted[0].price);
  }
}

module.exports = OrderbookPoller;
