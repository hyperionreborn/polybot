const express = require("express");
const http = require("http");
const path = require("path");
const { Server: SocketIO } = require("socket.io");
const cors = require("cors");

const config = require("./config");
const Store = require("./store");
const BinanceFeed = require("./binance");
const MarketDiscovery = require("./markets");
const OrderbookPoller = require("./orderbook");
const Executor = require("./executor");
const SniperStrategy = require("./strategies/sniper");
const HedgeStrategy = require("./strategies/hedge");
const StopLossMonitor = require("./stoploss");
const StrategyLabEngine = require("./strategy-lab/engine");
const createRouter = require("./routes");

const app = express();
const server = http.createServer(app);
const io = new SocketIO(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());

// Serve built frontend in production
const clientDist = path.join(__dirname, "..", "client", "dist");
app.use(express.static(clientDist));

// ── State ──────────────────────────────────────────────
const store = new Store(config.defaults);

// ── CLOB Client (lazy init — only if keys are configured) ──
let clobClient = null;

async function initClob() {
  if (!config.clob.privateKey || config.clob.privateKey === "0x...") {
    console.warn("[CLOB] No private key configured — running in view-only mode");
    return null;
  }
  try {
    const { ClobClient } = require("@polymarket/clob-client");
    const { Wallet } = require("ethers");

    const signer = new Wallet(config.clob.privateKey);
    console.log("[CLOB] Signer address:", signer.address);

    // Step 1: create a temp client with just the signer to derive API keys
    const tempClient = new ClobClient(
      config.clob.host,
      config.clob.chainId,
      signer
    );

    // Step 2: derive or create L2 API credentials
    console.log("[CLOB] Deriving API credentials...");
    const apiCreds = await tempClient.createOrDeriveApiKey();
    console.log("[CLOB] API key derived:", apiCreds.key ? apiCreds.key.slice(0, 8) + "..." : "none");

    // Step 3: initialize the full trading client with signer + creds + signatureType + funderAddress
    const client = new ClobClient(
      config.clob.host,
      config.clob.chainId,
      signer,
      apiCreds,
      config.clob.signatureType,
      config.clob.funderAddress   // 6th arg: proxy wallet that holds the funds
    );

    console.log("[CLOB] Client initialized (signatureType=%d, funder=%s)",
      config.clob.signatureType,
      config.clob.funderAddress || "not set"
    );
    return client;
  } catch (err) {
    console.error("[CLOB] Init failed:", err.message);
    return null;
  }
}

// ── Binance Price Feed ─────────────────────────────────
let lastPriceEmit = 0;
const binance = new BinanceFeed(config.binanceWs, (price) => {
  store.btcPrice = price;
  const now = Date.now();
  // Throttle Socket.IO price events to every 300ms (smooth but not spammy)
  if (now - lastPriceEmit > 300) {
    io.emit("price", price);
    lastPriceEmit = now;
  }
});

// ── Market Discovery ───────────────────────────────────
const discovery = new MarketDiscovery(config.gammaApi, config.gammaInterval);

// ── Main loop pieces (set up after async init) ─────────
let executor, sniper, hedge, stopLoss, labEngine, orderbookPoller, strategyTimer;

// ── Balance polling ────────────────────────────────────
async function fetchBalance() {
  if (!clobClient) return;
  try {
    const { AssetType } = require("@polymarket/clob-client");
    const resp = await clobClient.getBalanceAllowance({ asset_type: AssetType.COLLATERAL });
    
    // The response might be { balance: "0", allowances: { "0x...": "0" } } or just raw string
    // We should trust that if we can trade, we have funds.
    // If balance is 0, let's log the full object to debug once.
    let bal = parseFloat(resp.balance || "0");
    
    // If main balance is 0, check if we have any other asset balances if available
    // (The SDK mostly exposes the primary collateral balance)
    
    // Normalizing units (USDC has 6 decimals)
    if (bal > 1_000_000) bal = bal / 1e6;
    
    store.balance = bal;
    
    // Only log if it changes significantly or on startup
    // console.log("[BALANCE] USDC:", bal.toFixed(2));
  } catch (err) {
    console.error("[BALANCE] Fetch error:", err.message);
  }
}

async function boot() {
  clobClient = await initClob();
  executor = new Executor(clobClient, store, io);
  store._funderAddress = config.clob.funderAddress;

  // Fetch initial balance + poll every 30s
  await fetchBalance();
  setInterval(fetchBalance, 30_000);

  // Stop-loss monitor: polls held positions every 500ms, sells if bid < threshold
  stopLoss = new StopLossMonitor(clobClient, store, io, {
    pollMs: 500,
    threshold: config.defaults.stopLoss || 0.80,
  });
  stopLoss.start();

  sniper = new SniperStrategy(store, executor, stopLoss);
  hedge = new HedgeStrategy(store, executor, stopLoss);
  labEngine = new StrategyLabEngine(store, io, {
    gammaApi: config.gammaApi,
    tickMs: 1000,
  });
  labEngine.start();

  // API routes
  app.use("/api", createRouter(store, executor, sniper, hedge, labEngine));

  // SPA fallback
  app.get("*", (req, res) => {
    res.sendFile(path.join(clientDist, "index.html"));
  });

  // Start feeds
  binance.start();

  discovery.start((markets) => {
    store.markets = markets;
    io.emit("markets", markets);
  });

  // Orderbook polling — uses public CLOB API, no auth needed
  orderbookPoller = new OrderbookPoller(config.orderbookInterval);
  orderbookPoller.start(
    () => store.markets,
    (markets) => {
      store.markets = markets;
      io.emit("markets", markets);
    }
  );

  // Strategy tick — runs every 300ms for fast reaction
  strategyTimer = setInterval(() => {
    const now = Date.now();
    store.captureStartPrices(store.markets, now);
    sniper.tick(store.markets, store.btcPrice, now);
    hedge.tick(store.markets);
  }, config.strategyInterval || 300);

  // Socket.IO connections
  io.on("connection", (socket) => {
    console.log("[WS] Client connected:", socket.id);
    socket.emit("price", store.btcPrice);
    socket.emit("markets", store.markets);
    socket.emit("status", store.getStatus());
    socket.emit("lab", store._labStatus());

    socket.on("disconnect", () => {
      console.log("[WS] Client disconnected:", socket.id);
    });
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`\n  ✗ Port ${config.port} is already in use.`);
      console.error(`    Kill the old process first:\n`);
      console.error(`      PowerShell:  Get-NetTCPConnection -LocalPort ${config.port} | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }`);
      console.error(`      Or use:      npx kill-port ${config.port}\n`);
      process.exit(1);
    }
    throw err;
  });

  server.listen(config.port, () => {
    console.log(`\n  ✓ Polymarket BTC Bot running on http://localhost:${config.port}\n`);
    console.log(`  Dry run: sniper=${store.sniper.dryRun}, hedge=${store.hedge.dryRun}`);
    console.log(`  CLOB: ${clobClient ? "connected" : "view-only (no key)"}\n`);
  });
}

boot().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  binance.stop();
  discovery.stop();
  if (orderbookPoller) orderbookPoller.stop();
  if (stopLoss) stopLoss.stop();
  if (labEngine) labEngine.stop();
  if (strategyTimer) clearInterval(strategyTimer);
  server.close();
  process.exit(0);
});
