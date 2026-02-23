const LAB_CATEGORIES = {
  btc5m: { id: "btc5m", label: "BTC 5min", slugPrefix: "btc-updown-5m", seconds: 300, symbol: "BTCUSDT" },
  btc15m: { id: "btc15m", label: "BTC 15min", slugPrefix: "btc-updown-15m", seconds: 900, symbol: "BTCUSDT" },
  sol15m: { id: "sol15m", label: "SOL 15min", slugPrefix: "sol-updown-15m", seconds: 900, symbol: "SOLUSDT" },
  eth15m: { id: "eth15m", label: "ETH 15min", slugPrefix: "eth-updown-15m", seconds: 900, symbol: "ETHUSDT" },
  xrp15m: { id: "xrp15m", label: "XRP 15min", slugPrefix: "xrp-updown-15m", seconds: 900, symbol: "XRPUSDT" },
};

const DEFAULT_PRESET_CONFIG = {
  minPrice: 0.88,
  maxPrice: 0.99,
  betSize: 100,
  buffer: 0.0015,
  windowSec: 30,
  stopLoss: 0.75,
};

module.exports = {
  LAB_CATEGORIES,
  DEFAULT_PRESET_CONFIG,
};
