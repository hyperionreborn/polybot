# Polymarket BTC Bot

Single-page web app that scans Polymarket's 5-min and 15-min Bitcoin markets and runs two strategies:

- **Sniper** — Buys the winning side at 99¢ in the last 30 seconds when BTC is clearly above/below the strike
- **Hedge** — Buys YES and NO at different times when each dips cheap, locking profit when combined < $1.00

## Quick Start

```bash
# 1. Copy env file and fill in your credentials
cp .env.example .env

# 2. Install all dependencies
npm install
cd client && npm install && cd ..

# 3. Build frontend
cd client && npx vite build && cd ..

# 4. Start (backend serves built frontend on :3000)
npm run server
```

Open `http://localhost:3000`.

### Development Mode

```bash
npm start
```

This runs the backend on `:3000` and the Vite dev server on `:3001` with hot-reload (proxied to the backend).

## Configuration

Set in `.env`:

| Variable | Description |
|----------|-------------|
| `PRIVATE_KEY` | Polymarket/Polygon wallet private key |
| `FUNDER_ADDRESS` | Your funder address |
| `SIGNATURE_TYPE` | Signature type (default: `1`) |

All strategy settings (bet size, thresholds, dry run) are adjustable from the UI.

**Dry run mode is ON by default** — the bot logs simulated trades without placing real orders.

## Architecture

```
poly/
├── server/
│   ├── index.js          # Express + Socket.IO entry point
│   ├── config.js         # Environment + default settings
│   ├── store.js          # Runtime state + trade persistence
│   ├── binance.js        # BTC price WebSocket feed
│   ├── markets.js        # Gamma API market discovery
│   ├── orderbook.js      # CLOB order book polling
│   ├── executor.js       # Order placement (FOK)
│   ├── routes.js         # REST API endpoints
│   └── strategies/
│       ├── sniper.js     # Sniper strategy logic
│       └── hedge.js      # Hedge strategy logic
├── client/
│   └── src/
│       ├── App.jsx       # Main single-page layout
│       ├── hooks/        # useSocket, useApi
│       └── components/   # Header, MarketList, StrategyCard, LogPanel, EmergencyStop
├── trades.json           # Append-only trade log (created at runtime)
├── .env                  # Your credentials (not committed)
└── package.json
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/status` | BTC price, balance, markets, positions |
| `POST` | `/api/sniper/toggle` | Start/stop sniper |
| `POST` | `/api/hedge/toggle` | Start/stop hedge |
| `PUT` | `/api/config` | Update settings |
| `POST` | `/api/emergency-stop` | Kill everything |

Socket.IO events: `price`, `markets`, `trade`, `log`, `status`
