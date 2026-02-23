const axios = require("axios");
const { LAB_CATEGORIES, DEFAULT_PRESET_CONFIG } = require("./constants");

const CLOB_BASE = "https://clob.polymarket.com";
const BINANCE_REST = "https://api.binance.com/api/v3/ticker/price";

class StrategyLabEngine {
  constructor(store, io, config) {
    this.store = store;
    this.io = io;
    this.gammaApi = config.gammaApi;
    this.tickMs = config.tickMs || 1000;
    this.timer = null;
    this.marketCache = new Map();
    this.bookCache = new Map();
    this.priceCache = new Map();
    this.marketFetchInflight = new Map();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this._tick(), this.tickMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  getStatus() {
    return this.store._labStatus();
  }

  getCategories() {
    return Object.values(LAB_CATEGORIES).map((c) => ({
      id: c.id,
      label: c.label,
      seconds: c.seconds,
      slugPrefix: c.slugPrefix,
      symbol: c.symbol,
    }));
  }

  createPreset(input) {
    const id = Math.random().toString(36).slice(2, 10);
    const category = LAB_CATEGORIES[input.category] ? input.category : "btc5m";
    const startingCash = this._num(input.startingCash, this.store.lab.defaultStartingCash);
    const config = this._normalizeConfig(input.config || {});
    const preset = {
      id,
      name: input.name || `Preset ${this.store.lab.presets.length + 1}`,
      category,
      running: false,
      startingCash,
      cash: startingCash,
      equity: startingCash,
      wins: 0,
      losses: 0,
      trades: 0,
      stopLossHits: 0,
      config,
      positions: [],
      logs: [],
      curve: [],
      tradeHistory: [],
      tradedCycles: {},
      startSnapshots: {},
      pendingCycleKey: null,
      dataHealth: {
        status: "Booting",
        marketAgeSec: null,
        priceAgeSec: null,
        bookAgeSec: null,
        detail: "Waiting for first lab tick",
      },
      lastMarketAt: 0,
      lastPriceAt: 0,
      lastBookAt: 0,
      lastTickAt: 0,
      lastErrorAt: 0,
      updatedAt: Date.now(),
    };
    this.store.upsertLabPreset(preset);
    this.store.addLabCurvePoint(preset, { ts: Date.now(), equity: preset.equity });
    this.store.emitLabStatus(this.io);
    return preset;
  }

  updatePreset(id, update) {
    const preset = this._getPreset(id);
    if (!preset) return null;
    if (update.name !== undefined) preset.name = String(update.name || preset.name).slice(0, 50);
    if (update.category !== undefined && LAB_CATEGORIES[update.category]) preset.category = update.category;
    if (update.startingCash !== undefined) {
      const next = this._num(update.startingCash, preset.startingCash);
      if (next > 0) {
        const diff = next - preset.startingCash;
        preset.startingCash = next;
        if (!preset.running && (!preset.positions || preset.positions.length === 0)) {
          preset.cash = parseFloat((preset.cash + diff).toFixed(2));
          preset.equity = preset.cash;
        }
      }
    }
    if (update.config) {
      preset.config = { ...preset.config, ...this._normalizeConfig(update.config, preset.config) };
    }
    preset.updatedAt = Date.now();
    this.store.emitLabStatus(this.io);
    return preset;
  }

  deletePreset(id) {
    this.store.removeLabPreset(id);
    this.store.emitLabStatus(this.io);
  }

  setPresetRunning(id, running) {
    const preset = this._getPreset(id);
    if (!preset) return null;
    if (running) {
      const active = this.store.lab.presets.filter((p) => p.running).length;
      if (active >= this.store.lab.maxActive && !preset.running) {
        throw new Error(`Only ${this.store.lab.maxActive} presets can run at once`);
      }
    }
    preset.running = Boolean(running);
    preset.updatedAt = Date.now();
    this.store.emitLabStatus(this.io);
    return preset;
  }

  resetPreset(id) {
    const preset = this._getPreset(id);
    if (!preset) return null;
    preset.running = false;
    this.store.resetLabPresetRuntime(preset);
    this.store.addLabCurvePoint(preset, { ts: Date.now(), equity: preset.equity });
    this.store.emitLabStatus(this.io);
    return preset;
  }

  exportPresets() {
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      presets: this.store.lab.presets.map((preset) => ({
        name: preset.name,
        category: preset.category,
        startingCash: preset.startingCash,
        config: { ...preset.config },
      })),
    };
  }

  importPresets(payload, options = {}) {
    const mode = options.mode === "replace" ? "replace" : "merge";
    const incoming = Array.isArray(payload?.presets) ? payload.presets : [];
    if (!incoming.length) {
      throw new Error("Import payload must include a non-empty presets array");
    }
    const sanitized = incoming
      .map((p) => this._sanitizeImportedPreset(p))
      .filter(Boolean);
    if (!sanitized.length) {
      throw new Error("No valid presets found in import payload");
    }

    if (mode === "replace") {
      this.store.lab.presets = [];
    }

    for (const p of sanitized) {
      this.createPreset(p);
    }
    this.store.emitLabStatus(this.io);
    return this.getStatus();
  }

  async _tick() {
    const running = this.store.lab.presets.filter((p) => p.running);
    if (!running.length) return;
    await Promise.allSettled(running.map((preset) => this._runPreset(preset)));
    this.store.emitLabStatus(this.io);
  }

  async _runPreset(preset) {
    const categoryCfg = LAB_CATEGORIES[preset.category];
    if (!categoryCfg) return;
    const now = Date.now();
    preset.lastTickAt = now;
    try {
      const decision = {
        ts: now,
        marketId: null,
        windowStart: null,
        resolutionTime: null,
        secsLeft: null,
        symbolPrice: null,
        startPrice: null,
        pctDiff: null,
        marketSide: null,
        askPrice: null,
        confirms: null,
        rejection: null,
        constraints: {
          cash: preset.cash,
          cycleKey: null,
          pending: false,
          traded: false,
          openPosition: false,
        }
      };
      
      const market = await this._fetchLatestMarket(categoryCfg, now);
      if (!market) {
        this.store.addLabLog(preset, { strategy: "LAB", action: "WAIT", reason: `No reachable ${categoryCfg.label} market (API timeout/retry)` });
        decision.rejection = "No reachable market";
        preset.latestDecision = decision;
        return;
      }
      

      decision.marketId = market.id;
      decision.windowStart = market.windowStart;
      decision.resolutionTime = market.resolutionTime;
      
      // Fetch live CLOB prices
      if (market.upTokenId) {
        const prices = await this._fetchBookPrices(market.upTokenId);
        if (prices.bestAsk !== null) market.upAsk = prices.bestAsk;
      }
      if (market.downTokenId) {
        const prices = await this._fetchBookPrices(market.downTokenId);
        if (prices.bestAsk !== null) market.downAsk = prices.bestAsk;
      }

      decision.upAsk = market.upAsk;
      decision.downAsk = market.downAsk;
      
      preset.lastMarketAt = now;
      const cycleKey = `${preset.category}-${market.windowStart}`;
      decision.constraints.cycleKey = cycleKey;
      
      const symbolPrice = await this._fetchPrice(categoryCfg.symbol);
      if (!symbolPrice) {
        preset.lastErrorAt = now;
        decision.rejection = "Symbol price unavailable";
        preset.latestDecision = decision;
        return;
      }
      preset.lastPriceAt = now;
      decision.symbolPrice = symbolPrice;

      if (!preset.startSnapshots[cycleKey] && now >= market.windowStart) {
        preset.startSnapshots[cycleKey] = symbolPrice;
      }
      const startPrice = preset.startSnapshots[cycleKey];
      decision.startPrice = startPrice;
      
      if (!startPrice) {
        decision.rejection = "Waiting for window start to snapshot price";
        preset.latestDecision = decision;
        return;
      }

      await this._checkStopLosses(preset);
      await this._checkResolvedPositions(preset);

      if (preset.pendingCycleKey === cycleKey) {
        decision.constraints.pending = true;
        decision.rejection = "Order pending for cycle";
        preset.latestDecision = decision;
        return;
      }
      if (preset.tradedCycles[cycleKey]) {
        decision.constraints.traded = true;
        decision.rejection = "Already traded this cycle";
        preset.latestDecision = decision;
        return;
      }
      if (preset.positions.some((p) => p.state === "open" && p.cycleKey === cycleKey)) {
        decision.constraints.openPosition = true;
        decision.rejection = "Open position exists for cycle";
        preset.latestDecision = decision;
        return;
      }

      const secsLeft = (market.resolutionTime - now) / 1000;
      decision.secsLeft = secsLeft;
      
      if (secsLeft > preset.config.windowSec || secsLeft < 0) {
        decision.rejection = `Outside window (${Math.round(secsLeft)}s > ${preset.config.windowSec}s)`;
        preset.latestDecision = decision;
        return;
      }

      const sideInfo = this._pickSide(market, symbolPrice, startPrice, preset.config, decision);
      if (!sideInfo) {
        // rejection reason is set inside _pickSide mutation of decision object if applicable
        preset.latestDecision = decision;
        return;
      }
      
      decision.marketSide = sideInfo.side;
      decision.askPrice = sideInfo.askPrice;
      decision.confirms = true;

      let qty = Math.floor(preset.config.betSize / sideInfo.askPrice);
      if (qty <= 0) {
        decision.rejection = `Bet size too small for price $${sideInfo.askPrice}`;
        preset.latestDecision = decision;
        return;
      }
      
      const cost = parseFloat((qty * sideInfo.askPrice).toFixed(2));
      if (cost > preset.cash) {
        this.store.addLabLog(preset, { strategy: "LAB", action: "SKIP", reason: "Insufficient cash", marketId: market.id });
        decision.rejection = `Insufficient cash ($${preset.cash} < $${cost})`;
        preset.latestDecision = decision;
        return;
      }

      preset.pendingCycleKey = cycleKey;
      preset.cash = parseFloat((preset.cash - cost).toFixed(2));
      preset.tradedCycles[cycleKey] = true;
      const tokenId = sideInfo.side === "Up" ? market.upTokenId : market.downTokenId;
      preset.positions.push({
        id: `${preset.id}-${cycleKey}`,
        cycleKey,
        marketId: market.id,
        marketSlug: market.slug,
        marketQuestion: market.question,
        tokenId,
        side: sideInfo.side,
        qty,
        entryPrice: sideInfo.askPrice,
        stopLoss: preset.config.stopLoss,
        resolutionTime: market.resolutionTime,
        state: "open",
        openedAt: now,
      });
      preset.trades += 1;
      preset.pendingCycleKey = null;
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/35f58e78-98db-4b47-9255-f761cd0baa79',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'engine.js:BUY-pre-history',message:'BUY: about to push tradeHistory',hypothesisId:'H-A-B-C',data:{presetId:preset.id,tradeHistoryType:typeof preset.tradeHistory,tradeHistoryLen:Array.isArray(preset.tradeHistory)?preset.tradeHistory.length:'NOT_ARRAY',tradesCount:preset.trades,cycleKey},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      // Record open trade in history
      preset.tradeHistory = [{
        id: `${preset.id}-${cycleKey}`,
        openedAt: now,
        closedAt: null,
        marketSlug: market.slug,
        side: sideInfo.side,
        qty,
        entryPrice: sideInfo.askPrice,
        exitPrice: null,
        cost: cost,
        proceeds: null,
        pnl: null,
        exitReason: "OPEN",
      }, ...(preset.tradeHistory || [])].slice(0, 200);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/35f58e78-98db-4b47-9255-f761cd0baa79',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'engine.js:BUY-post-history',message:'BUY: tradeHistory after push',hypothesisId:'H-C',data:{presetId:preset.id,tradeHistoryLen:Array.isArray(preset.tradeHistory)?preset.tradeHistory.length:'NOT_ARRAY',firstRecord:Array.isArray(preset.tradeHistory)?preset.tradeHistory[0]:null},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      const pctDiffPct = decision.pctDiff != null ? ((decision.pctDiff >= 0 ? "+" : "") + (decision.pctDiff * 100).toFixed(3) + "%") : "?%";
      this.store.addLabLog(preset, {
        strategy: "LAB",
        action: "BUY",
        side: sideInfo.side,
        price: sideInfo.askPrice,
        qty,
        marketId: market.id,
        reason: `${sideInfo.side} @ $${sideInfo.askPrice.toFixed(3)}, ${qty} shares | BTC ${pctDiffPct} | ${Math.round(secsLeft)}s left`,
      });
      decision.rejection = null; // Success
      decision.action = "BUY";
      preset.latestDecision = decision;
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/35f58e78-98db-4b47-9255-f761cd0baa79',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'engine.js:342',message:'Decision assigned (success path)',data:{preset: preset.id, rejection: decision.rejection},timestamp:Date.now()})}).catch(()=>{});
      // #endregion

      await this._markToMarket(preset);
    } finally {
      this._refreshDataHealth(preset, Date.now());
    }
  }

  _pickSide(market, currentPrice, startPrice, cfg, decisionContext) {
    const upAsk = market.upAsk;
    const downAsk = market.downAsk;
    const minPrice = cfg.minPrice;
    const maxPrice = cfg.maxPrice;
    let marketSide = null;
    let askPrice = null;
    if (upAsk !== null && upAsk >= minPrice && upAsk <= maxPrice) {
      marketSide = "Up";
      askPrice = upAsk;
    } else if (downAsk !== null && downAsk >= minPrice && downAsk <= maxPrice) {
      marketSide = "Down";
      askPrice = downAsk;
    }
    
    if (!marketSide) {
      if (decisionContext) {
        decisionContext.rejection = `No side in price range [${minPrice}-${maxPrice}] (Up:${upAsk}, Down:${downAsk})`;
      }
      return null;
    }

    const pctDiff = (currentPrice - startPrice) / startPrice;
    if (decisionContext) {
      decisionContext.pctDiff = pctDiff;
      decisionContext.marketSide = marketSide;
      decisionContext.askPrice = askPrice;
    }

    if (Math.abs(pctDiff) < cfg.buffer) {
      if (decisionContext) {
        decisionContext.rejection = `Buffer too low (${(Math.abs(pctDiff) * 100).toFixed(4)}% < ${(cfg.buffer * 100).toFixed(4)}%)`;
      }
      return null;
    }

    const confirms = (marketSide === "Up" && pctDiff > 0) || (marketSide === "Down" && pctDiff < 0);
    if (!confirms) {
      if (decisionContext) {
        decisionContext.rejection = `Trend mismatch: Market ${marketSide} but BTC ${pctDiff > 0 ? "Up" : "Down"} ${(pctDiff * 100).toFixed(3)}%`;
        decisionContext.confirms = false;
      }
      return null;
    }
    
    return { side: marketSide, askPrice };
  }

  async _checkStopLosses(preset) {
    for (const pos of preset.positions) {
      if (pos.state !== "open") continue;
      const bestBid = await this._bestBid(pos.tokenId);
      preset.lastBookAt = Date.now();
      if (bestBid > 0 && bestBid < pos.stopLoss) {
        pos.state = "closed";
        const proceeds = parseFloat((bestBid * pos.qty).toFixed(2));
        preset.cash = parseFloat((preset.cash + proceeds).toFixed(2));
        const pnl = parseFloat(((bestBid - pos.entryPrice) * pos.qty).toFixed(2));
        if (pnl >= 0) preset.wins += 1;
        else preset.losses += 1;
        preset.stopLossHits += 1;
        // Update trade history record
        const stopTh = (preset.tradeHistory || []).find((t) => t.id === pos.id);
        if (stopTh) {
          stopTh.closedAt = Date.now();
          stopTh.exitPrice = bestBid;
          stopTh.proceeds = proceeds;
          stopTh.pnl = pnl;
          stopTh.exitReason = "STOP";
        }
        this.store.addLabLog(preset, {
          strategy: "LAB",
          action: "STOP",
          side: pos.side,
          price: bestBid,
          qty: pos.qty,
          marketId: pos.marketId,
          reason: `Stop loss hit: exit $${bestBid.toFixed(3)} (entry $${pos.entryPrice.toFixed(3)}) | PnL ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} | ${pos.side}`,
        });
      }
    }
    await this._markToMarket(preset);
  }

  async _checkResolvedPositions(preset) {
    const now = Date.now();
    for (const pos of preset.positions) {
      if (pos.state !== "open") continue;
      if (now < pos.resolutionTime) continue;
      const market = await this._fetchEventBySlug(pos.marketSlug);
      if (!market) continue;
      const settled = this._settleFromOutcomePrices(market, pos.side);
      if (settled === null) continue;
      pos.state = "closed";
      const exitPrice = settled ? 1 : 0;
      const proceeds = parseFloat((exitPrice * pos.qty).toFixed(2));
      preset.cash = parseFloat((preset.cash + proceeds).toFixed(2));
      const pnl = parseFloat(((exitPrice - pos.entryPrice) * pos.qty).toFixed(2));
      if (pnl >= 0) preset.wins += 1;
      else preset.losses += 1;
      // Update trade history record
      const settleTh = (preset.tradeHistory || []).find((t) => t.id === pos.id);
      if (settleTh) {
        settleTh.closedAt = Date.now();
        settleTh.exitPrice = exitPrice;
        settleTh.proceeds = proceeds;
        settleTh.pnl = pnl;
        settleTh.exitReason = "RESOLVED";
      }
      this.store.addLabLog(preset, {
        strategy: "LAB",
        action: "SETTLE",
        side: pos.side,
        price: exitPrice,
        qty: pos.qty,
        marketId: pos.marketId,
          reason: `Resolved ${settled ? "WIN" : "LOSS"}: exit $${exitPrice.toFixed(2)} (entry $${pos.entryPrice.toFixed(3)}) | PnL ${pnl >= 0 ? "+" : ""}$${pnl.toFixed(2)} | ${pos.side}`,
      });
    }
    await this._markToMarket(preset);
  }

  async _markToMarket(preset) {
    let mtm = 0;
    for (const pos of preset.positions) {
      if (pos.state !== "open") continue;
      const bid = await this._bestBid(pos.tokenId);
      preset.lastBookAt = Date.now();
      if (bid > 0) mtm += bid * pos.qty;
    }
    preset.equity = parseFloat((preset.cash + mtm).toFixed(2));
    this.store.addLabCurvePoint(preset, { ts: Date.now(), equity: preset.equity });
  }

  _settleFromOutcomePrices(market, side) {
    let outcomes = [];
    let prices = [];
    try { outcomes = JSON.parse(market.outcomes || "[]"); } catch {}
    try { prices = JSON.parse(market.outcomePrices || "[]").map(Number); } catch {}
    if (!outcomes.length || !prices.length) return null;
    const idx = outcomes.findIndex((o) => String(o).toLowerCase() === side.toLowerCase());
    if (idx < 0) return null;
    const p = prices[idx];
    if (p >= 0.99) return true;
    if (p <= 0.01) return false;
    return null;
  }

  async _fetchLatestMarket(categoryCfg, nowMs) {
    const inflight = this.marketFetchInflight.get(categoryCfg.id);
    if (inflight) {
      return inflight;
    }
    const promise = this._fetchLatestMarketInner(categoryCfg, nowMs);
    this.marketFetchInflight.set(categoryCfg.id, promise);
    try {
      return await promise;
    } finally {
      this.marketFetchInflight.delete(categoryCfg.id);
    }
  }

  async _fetchLatestMarketInner(categoryCfg, nowMs) {
    const cached = this.marketCache.get(categoryCfg.id);
    if (cached && cached.expiresAt > nowMs) return cached.market;
    const nowSec = Math.floor(nowMs / 1000);
    const currentWindowStart = nowSec - (nowSec % categoryCfg.seconds);
    const slugs = [-1, 0, 1, 2].map((offset) => ({
      slug: `${categoryCfg.slugPrefix}-${currentWindowStart + offset * categoryCfg.seconds}`,
      windowStart: (currentWindowStart + offset * categoryCfg.seconds) * 1000,
      windowEnd: (currentWindowStart + offset * categoryCfg.seconds + categoryCfg.seconds) * 1000,
    }));
    const results = await Promise.allSettled(slugs.map((s) => this._fetchEventBySlug(s.slug, s)));
    const markets = results
      .filter((r) => r.status === "fulfilled" && r.value)
      .map((r) => r.value)
      .filter((m) => m.active && m.acceptingOrders && m.resolutionTime > nowMs);
    if (!markets.length) {
      // Fallback to last known market briefly to avoid false "no market" bursts on API hiccups.
      if (cached && cached.market && cached.market.resolutionTime > nowMs) {
        return cached.market;
      }
      return null;
    }
    markets.sort((a, b) => a.resolutionTime - b.resolutionTime);
    const market = markets[0];
    this.marketCache.set(categoryCfg.id, { market, expiresAt: nowMs + 1800 });
    return market;
  }

  async _fetchEventBySlug(slug, fallbackWindow) {
    const { data } = await axios.get(this.gammaApi, {
      params: { slug },
      timeout: 3000,
    }).catch(() => ({ data: [] }));
    if (!Array.isArray(data) || !data.length) return null;
    const event = data[0];
    const market = (event.markets || [])[0];
    if (!market) return null;
    let tokenIds = [];
    let outcomes = [];
    let outcomePrices = [];
    try { tokenIds = JSON.parse(market.clobTokenIds || "[]"); } catch {}
    try { outcomes = JSON.parse(market.outcomes || "[]"); } catch {}
    try { outcomePrices = JSON.parse(market.outcomePrices || "[]").map(Number); } catch {}
    const upIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "up");
    const downIdx = outcomes.findIndex((o) => String(o).toLowerCase() === "down");
    const upTokenId = upIdx >= 0 ? tokenIds[upIdx] : "";
    const downTokenId = downIdx >= 0 ? tokenIds[downIdx] : "";
    const upAsk = upIdx >= 0 ? outcomePrices[upIdx] || null : null;
    const downAsk = downIdx >= 0 ? outcomePrices[downIdx] || null : null;
    const resolutionTime = market.endDate ? new Date(market.endDate).getTime() : (fallbackWindow?.windowEnd || 0);
    const windowStart = event.startTime ? new Date(event.startTime).getTime() : (fallbackWindow?.windowStart || 0);
    return {
      id: market.id,
      slug: event.slug || slug,
      question: market.question || event.title || slug,
      upTokenId,
      downTokenId,
      upAsk,
      downAsk,
      outcomes: market.outcomes,
      outcomePrices: market.outcomePrices,
      active: market.active !== false,
      acceptingOrders: market.acceptingOrders !== false,
      windowStart,
      resolutionTime,
    };
  }

  async _fetchBookPrices(tokenId) {
    const now = Date.now();
    const cached = this.bookCache.get(tokenId);
    if (cached && cached.expiresAt > now) return cached.prices;
    
    const { data: book } = await axios.get(`${CLOB_BASE}/book`, {
      params: { token_id: tokenId },
      timeout: 2500,
    }).catch(() => ({ data: null }));

    let bestBid = 0;
    let bestAsk = null;

    if (book) {
      if (Array.isArray(book.bids)) {
        for (const bid of book.bids) {
          const p = parseFloat(bid.price);
          if (p > bestBid) bestBid = p;
        }
      }
      if (Array.isArray(book.asks) && book.asks.length > 0) {
        const sorted = [...book.asks].sort((a, b) => parseFloat(a.price) - parseFloat(b.price));
        bestAsk = parseFloat(sorted[0].price);
      }
    }

    const prices = { bestBid, bestAsk };
    this.bookCache.set(tokenId, { prices, expiresAt: now + 600 });
    return prices;
  }

  async _bestBid(tokenId) {
    const prices = await this._fetchBookPrices(tokenId);
    return prices.bestBid;
  }

  async _fetchPrice(symbol) {
    const now = Date.now();
    const cached = this.priceCache.get(symbol);
    if (cached && cached.expiresAt > now) return cached.price;
    const { data } = await axios.get(BINANCE_REST, {
      params: { symbol },
      timeout: 2000,
    }).catch(() => ({ data: null }));
    const price = data && data.price ? parseFloat(data.price) : 0;
    if (!price) return 0;
    this.priceCache.set(symbol, { price, expiresAt: now + 900 });
    return price;
  }

  _normalizeConfig(input, base = DEFAULT_PRESET_CONFIG) {
    return {
      minPrice: this._num(input.minPrice, base.minPrice),
      maxPrice: this._num(input.maxPrice, base.maxPrice),
      betSize: this._num(input.betSize, base.betSize),
      buffer: this._num(input.buffer, base.buffer),
      windowSec: this._int(input.windowSec, base.windowSec),
      stopLoss: this._num(input.stopLoss, base.stopLoss),
    };
  }

  _num(v, fallback) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : fallback;
  }

  _int(v, fallback) {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : fallback;
  }

  _getPreset(id) {
    return this.store.lab.presets.find((p) => p.id === id);
  }

  _refreshDataHealth(preset, now = Date.now()) {
    const age = (ts) => (ts ? Math.max(0, Math.round((now - ts) / 1000)) : null);
    const marketAgeSec = age(preset.lastMarketAt);
    const priceAgeSec = age(preset.lastPriceAt);
    const bookAgeSec = age(preset.lastBookAt);

    let status = "Healthy";
    if (marketAgeSec === null || priceAgeSec === null) {
      status = "Booting";
    } else if (marketAgeSec > 8 || priceAgeSec > 6) {
      status = "Stale";
    } else if (marketAgeSec > 4 || priceAgeSec > 3) {
      status = "Degraded";
    }

    let detail = `Market ${marketAgeSec ?? "-"}s, price ${priceAgeSec ?? "-"}s`;
    if (bookAgeSec !== null) detail += `, book ${bookAgeSec}s`;
    if (preset.lastErrorAt && now - preset.lastErrorAt < 10_000) detail += " (recent fetch error)";

    preset.dataHealth = { status, marketAgeSec, priceAgeSec, bookAgeSec, detail };
    return preset.dataHealth;
  }

  _sanitizeImportedPreset(raw) {
    if (!raw || typeof raw !== "object") return null;
    const category = LAB_CATEGORIES[raw.category] ? raw.category : "btc5m";
    const name = String(raw.name || "").trim().slice(0, 50) || `Imported ${category.toUpperCase()}`;
    const startingCash = this._num(raw.startingCash, this.store.lab.defaultStartingCash);
    const config = this._normalizeConfig(raw.config || {});
    return { name, category, startingCash, config };
  }
}

module.exports = StrategyLabEngine;
