const fs = require("fs");
const path = require("path");

const TRADES_FILE = path.join(__dirname, "..", "trades.json");
const LAB_LOG_TTL_MS = 4000;

/**
 * Append-only trade log stored on disk as JSON lines.
 * Also keeps runtime state: settings, stats, active markets.
 *
 * Tracks BTC price snapshots at market window starts for sniper decisions.
 */
class Store {
  constructor(defaults) {
    this.btcPrice = 0;
    this.balance = 0;

    // BTC price snapshots keyed by market id → price at window start
    this.startPrices = {};

    this.sniper = { ...defaults.sniper, wins: 0, losses: 0, pnl: 0, status: "Idle" };
    this.hedge = { ...defaults.hedge, wins: 0, losses: 0, pnl: 0, status: "Idle", upQty: 0, downQty: 0 };

    this.markets = [];
    this.positions = {};
    this.logs = [];
    this.lab = {
      presets: [],
      maxActive: 3,
      maxLogs: 300,
      maxCurvePoints: 500,
      defaultStartingCash: 1000,
    };
    this._labLogDedupe = new Map();

    if (!fs.existsSync(TRADES_FILE)) {
      fs.writeFileSync(TRADES_FILE, "");
    }
  }

  /**
   * Snapshot BTC price at market window start.
   * Called each tick — only captures if we haven't already and the window has started.
   */
  captureStartPrices(markets, now) {
    for (const market of markets) {
      if (this.startPrices[market.id]) continue;
      if (now >= market.windowStart && this.btcPrice > 0) {
        this.startPrices[market.id] = this.btcPrice;
        market.startPrice = this.btcPrice;
        this.addLog({
          strategy: "SYSTEM",
          action: "SNAPSHOT",
          reason: `BTC start price $${this.btcPrice.toFixed(2)} for ${market.question}`,
        });
      }
    }

    // Attach cached start prices to markets
    for (const market of markets) {
      if (this.startPrices[market.id]) {
        market.startPrice = this.startPrices[market.id];
      }
    }

    // Clean up old snapshots for markets no longer tracked
    const activeIds = new Set(markets.map((m) => m.id));
    for (const id of Object.keys(this.startPrices)) {
      if (!activeIds.has(id)) {
        delete this.startPrices[id];
      }
    }
  }

  addLog(entry) {
    const ts = new Date().toISOString();
    const logEntry = { ts, ...entry };
    this.logs.unshift(logEntry);
    if (this.logs.length > 200) this.logs.length = 200;
    return logEntry;
  }

  recordTrade(trade) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...trade });
    fs.appendFileSync(TRADES_FILE, line + "\n");
    return this.addLog(trade);
  }

  getStatus() {
    return {
      btcPrice: this.btcPrice,
      balance: this.balance,
      markets: this.markets,
      sniper: { ...this.sniper },
      hedge: { ...this.hedge },
      logs: this.logs.slice(0, 50),
      lab: this._labStatus(),
    };
  }

  _labStatus() {
    // #region agent log
    const _presetsWithTrades = this.lab.presets.filter(p => p.trades > 0);
    if (_presetsWithTrades.length > 0) {
      fetch('http://127.0.0.1:7243/ingest/35f58e78-98db-4b47-9255-f761cd0baa79',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'store.js:_labStatus',message:'_labStatus called with traded presets',hypothesisId:'H-D',data:{presets:_presetsWithTrades.map(p=>({id:p.id,trades:p.trades,tradeHistoryType:typeof p.tradeHistory,tradeHistoryLen:Array.isArray(p.tradeHistory)?p.tradeHistory.length:'NOT_ARRAY'}))},timestamp:Date.now()})}).catch(()=>{});
    }
    // #endregion
    return {
      maxActive: this.lab.maxActive,
      defaultStartingCash: this.lab.defaultStartingCash,
      presets: this.lab.presets.map((preset) => ({
        id: preset.id,
        name: preset.name,
        category: preset.category,
        running: Boolean(preset.running),
        startingCash: preset.startingCash,
        cash: preset.cash,
        equity: preset.equity,
        wins: preset.wins,
        losses: preset.losses,
        trades: preset.trades,
        stopLossHits: preset.stopLossHits,
        pnl: parseFloat((preset.equity - preset.startingCash).toFixed(2)),
        winRate: preset.trades > 0 ? parseFloat(((preset.wins / preset.trades) * 100).toFixed(2)) : 0,
        openPositions: Array.isArray(preset.positions) ? preset.positions.length : 0,
        config: { ...preset.config },
        curve: (preset.curve || []).slice(-this.lab.maxCurvePoints),
        logs: (preset.logs || []).slice(0, 100),
        tradeHistory: (preset.tradeHistory || []).slice(0, 200),
        dataHealth: preset.dataHealth || null,
        latestDecision: preset.latestDecision || null,
        updatedAt: preset.updatedAt || Date.now(),
      })),
    };
  }

  emitLabStatus(io) {
    if (!io) return;
    io.emit("lab", this._labStatus());
    io.emit("status", this.getStatus());
  }

  upsertLabPreset(preset) {
    const idx = this.lab.presets.findIndex((p) => p.id === preset.id);
    if (idx >= 0) {
      this.lab.presets[idx] = preset;
    } else {
      this.lab.presets.push(preset);
    }
  }

  removeLabPreset(id) {
    this.lab.presets = this.lab.presets.filter((p) => p.id !== id);
  }

  resetLabPresetRuntime(preset) {
    preset.cash = preset.startingCash;
    preset.equity = preset.startingCash;
    preset.wins = 0;
    preset.losses = 0;
    preset.trades = 0;
    preset.stopLossHits = 0;
    preset.positions = [];
    preset.logs = [];
    preset.curve = [];
    preset.tradeHistory = [];
    preset.tradedCycles = {};
    preset.startSnapshots = {};
    preset.dataHealth = {
      status: "Booting",
      marketAgeSec: null,
      priceAgeSec: null,
      bookAgeSec: null,
      detail: "Waiting for first lab tick",
    };
    preset.lastMarketAt = 0;
    preset.lastPriceAt = 0;
    preset.lastBookAt = 0;
    preset.lastTickAt = 0;
    preset.lastErrorAt = 0;
    preset.updatedAt = Date.now();
  }

  addLabLog(preset, entry) {
    const ts = new Date().toISOString();
    const fingerprint = `${preset.id}|${entry.action || ""}|${entry.reason || ""}|${entry.marketId || ""}|${entry.side || ""}`;
    const now = Date.now();
    const seenAt = this._labLogDedupe.get(fingerprint) || 0;
    if (now - seenAt < LAB_LOG_TTL_MS) {
      return null;
    }
    this._labLogDedupe.set(fingerprint, now);
    const logEntry = { ts, ...entry };
    preset.logs = [logEntry, ...(preset.logs || [])].slice(0, this.lab.maxLogs);
    preset.updatedAt = now;
    return logEntry;
  }

  addLabCurvePoint(preset, point) {
    preset.curve = [...(preset.curve || []), point].slice(-this.lab.maxCurvePoints);
    preset.updatedAt = Date.now();
  }
}

module.exports = Store;
