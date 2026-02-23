const WebSocket = require("ws");

/**
 * Connects to Binance trade stream for BTCUSDT.
 * Emits price updates via callback. Auto-reconnects on disconnect.
 * Uses ping/pong to detect stale connections.
 */
class BinanceFeed {
  constructor(url, onPrice) {
    this.url = url;
    this.onPrice = onPrice;
    this.ws = null;
    this.lastPrice = 0;
    this.reconnectDelay = 1000;
    this.alive = false;
    this.pingTimer = null;
    this.messageCount = 0;
  }

  start() {
    this._connect();
  }

  _connect() {
    // Clean up any existing connection
    this._cleanup();

    console.log("[BINANCE] Connecting to", this.url);
    this.ws = new WebSocket(this.url);
    this.alive = false;
    this.messageCount = 0;

    this.ws.on("open", () => {
      console.log("[BINANCE] Connected");
      this.reconnectDelay = 1000;
      this.alive = true;

      // Heartbeat: check connection is alive every 30s
      this.pingTimer = setInterval(() => {
        if (!this.alive) {
          console.warn("[BINANCE] Connection stale, reconnecting...");
          this._reconnect();
          return;
        }
        this.alive = false;
        try { this.ws.ping(); } catch {}
      }, 30_000);
    });

    this.ws.on("pong", () => {
      this.alive = true;
    });

    this.ws.on("message", (raw) => {
      this.alive = true;
      try {
        const msg = JSON.parse(raw);
        const price = parseFloat(msg.p);
        if (!isNaN(price) && price > 0) {
          this.lastPrice = price;
          this.messageCount++;
          this.onPrice(price);
        }
      } catch {}
    });

    this.ws.on("close", (code) => {
      console.log(`[BINANCE] Disconnected (code ${code}), retrying in ${this.reconnectDelay}ms`);
      this._cleanup();
      setTimeout(() => this._connect(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30_000);
    });

    this.ws.on("error", (err) => {
      console.error("[BINANCE] Error:", err.message);
      try { this.ws.close(); } catch {}
    });
  }

  _reconnect() {
    this._cleanup();
    this._connect();
  }

  _cleanup() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    if (this.ws) {
      this.ws.removeAllListeners();
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  stop() {
    this._cleanup();
  }

  getStats() {
    return {
      connected: this.alive,
      lastPrice: this.lastPrice,
      messageCount: this.messageCount,
    };
  }
}

module.exports = BinanceFeed;
