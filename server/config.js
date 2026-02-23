require("dotenv").config();

module.exports = {
  port: parseInt(process.env.PORT, 10) || 3000,
  binanceWs: process.env.BINANCE_WS || "wss://stream.binance.com:9443/ws/btcusdt@trade",
  gammaApi: process.env.GAMMA_API || "https://gamma-api.polymarket.com/events",
  gammaInterval: 30_000,
  orderbookInterval: 500,    // orderbook poll every 500ms (parallel fetches)
  strategyInterval: 300,     // strategy tick every 300ms

  clob: {
    privateKey: process.env.PRIVATE_KEY || "",
    funderAddress: process.env.FUNDER_ADDRESS || "",
    signatureType: process.env.SIGNATURE_TYPE !== undefined ? parseInt(process.env.SIGNATURE_TYPE, 10) : 0,
    host: "https://clob.polymarket.com",
    chainId: 137,
  },

  defaults: {
    stopLoss: 0.70, // sell if bid drops below 80c
    sniper: {
      enabled: false,
      dryRun: true,
      minPrice: 0.88,   // only buy when market says 88%+ chance (the snipe)
      maxPrice: 0.99,    // don't overpay
      betSize: 100,
      buffer: 0.0015,
      windowSec: 30,
      slippage: 0.02,
      cooldown: 0,       // seconds to wait after a fill before next trade
      stopLoss: 0.75,    // sell if bid drops below 75c
    },
    hedge: {
      enabled: false,
      dryRun: true,
      maxCombined: 0.97,
      betSize: 25,
      maxSinglePrice: 0.48,
      slippage: 0.01, // 1 cent
    },
  },
};
