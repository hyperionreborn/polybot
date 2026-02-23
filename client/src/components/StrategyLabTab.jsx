import React, { useMemo, useRef, useState } from "react";

const CATEGORIES = [
  { id: "btc5m", label: "BTC 5min" },
  { id: "btc15m", label: "BTC 15min" },
  { id: "sol15m", label: "SOL 15min" },
  { id: "eth15m", label: "ETH 15min" },
  { id: "xrp15m", label: "XRP 15min" },
];

// ─── Chart ───────────────────────────────────────────────────────────────────

function linspace(min, max, n) {
  if (n <= 1) return [min];
  return Array.from({ length: n }, (_, i) => min + (i / (n - 1)) * (max - min));
}

function fmtMoney(v) {
  if (Math.abs(v) >= 1000) return `$${(v / 1000).toFixed(1)}k`;
  return `$${v.toFixed(0)}`;
}

function PresetChart({ curve, startingCash }) {
  const W = 400, H = 160;
  const pL = 52, pR = 10, pT = 10, pB = 24;
  const iW = W - pL - pR;
  const iH = H - pT - pB;

  const data = useMemo(() => {
    if (!curve || curve.length < 2) return null;
    const values = curve.map((p) => p.equity);
    const rawMin = Math.min(...values);
    const rawMax = Math.max(...values);
    const rawSpan = rawMax - rawMin;
    // Add 5% visual padding so line never hugs the edge
    const pad = Math.max(rawSpan * 0.08, (startingCash || rawMin) * 0.01, 0.5);
    const dMin = rawMin - pad;
    const dMax = rawMax + pad;
    const dSpan = dMax - dMin;

    const toX = (i) => pL + (i / (curve.length - 1)) * iW;
    const toY = (v) => pT + iH - ((v - dMin) / dSpan) * iH;

    const pathD = curve
      .map((p, i) => `${i === 0 ? "M" : "L"} ${toX(i).toFixed(1)} ${toY(p.equity).toFixed(1)}`)
      .join(" ");

    const yTicks = linspace(dMin, dMax, 5);
    const xTickIdxs = [0, Math.floor((curve.length - 1) / 2), curve.length - 1];

    // Starting cash Y (dashed baseline)
    const baselineY = toY(startingCash);
    const baselineVisible = startingCash >= dMin && startingCash <= dMax;

    return { pathD, yTicks, xTickIdxs, toX, toY, baselineY, baselineVisible, dMin, dMax };
  }, [curve, startingCash, pL, pT, iW, iH]);

  if (!data) {
    return (
      <div className="bg-dark-700 rounded-lg border border-dark-600 p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
          <text x={pL + iW / 2} y={pT + iH / 2 + 4} textAnchor="middle" fill="#555" fontSize="11">
            Chart appears after trades
          </text>
        </svg>
      </div>
    );
  }

  const { pathD, yTicks, xTickIdxs, toX, toY, baselineY, baselineVisible } = data;

  return (
    <div className="bg-dark-700 rounded-lg border border-dark-600 p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: H }}>
        {/* Y grid lines + labels */}
        {yTicks.map((v, i) => {
          const y = toY(v);
          return (
            <g key={i}>
              <line x1={pL} y1={y} x2={pL + iW} y2={y} stroke="#2a2a3a" strokeWidth="0.8" />
              <text x={pL - 4} y={y + 4} textAnchor="end" fill="#666" fontSize="9">
                {fmtMoney(v)}
              </text>
            </g>
          );
        })}

        {/* Starting cash baseline */}
        {baselineVisible && (
          <line
            x1={pL} y1={baselineY} x2={pL + iW} y2={baselineY}
            stroke="#5a5a7a" strokeWidth="1" strokeDasharray="5 3"
          />
        )}

        {/* Axis lines */}
        <line x1={pL} y1={pT} x2={pL} y2={pT + iH} stroke="#444" strokeWidth="1" />
        <line x1={pL} y1={pT + iH} x2={pL + iW} y2={pT + iH} stroke="#444" strokeWidth="1" />

        {/* Equity curve */}
        <path d={pathD} fill="none" stroke="#3b82f6" strokeWidth="2.2" strokeLinejoin="round" />

        {/* X ticks */}
        {xTickIdxs.map((idx) => {
          const pt = curve[idx];
          if (!pt) return null;
          const x = toX(idx);
          const label = new Date(pt.ts).toLocaleTimeString("en-US", {
            hour: "2-digit", minute: "2-digit", hour12: false,
          });
          return (
            <g key={idx}>
              <line x1={x} y1={pT + iH} x2={x} y2={pT + iH + 3} stroke="#555" strokeWidth="1" />
              <text x={x} y={pT + iH + 14} textAnchor="middle" fill="#666" fontSize="9">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Trade History Table ──────────────────────────────────────────────────────

function tradeTime(ts) {
  if (!ts) return "-";
  return new Date(ts).toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function shortSlug(slug) {
  if (!slug) return "-";
  // e.g. "btc-updown-1234567890" → show last segment
  const parts = slug.split("-");
  if (parts.length >= 3) return parts.slice(0, 2).join("-");
  return slug.slice(0, 12);
}

function TradeHistoryTable({ trades }) {
  // #region agent log
  React.useEffect(() => {
    if (trades && trades.length > 0) {
      fetch('http://127.0.0.1:7243/ingest/35f58e78-98db-4b47-9255-f761cd0baa79',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'StrategyLabTab.jsx:TradeHistoryTable',message:'TradeHistoryTable rendered with trades',hypothesisId:'H-E',data:{tradesLen:trades.length,first:trades[0]},timestamp:Date.now()})}).catch(()=>{});
    }
    console.log('[DEBUG TradeHistory] trades prop:', trades);
  }, [trades]);
  // #endregion
  const rows = (trades || []).slice(0, 50);
  if (!rows.length) {
    return (
      <div className="text-xs text-gray-500 italic p-3 bg-dark-700 rounded-lg border border-dark-600">
        No trades recorded yet. (received: {(trades||[]).length})
      </div>
    );
  }

  return (
    <div className="overflow-auto max-h-64 bg-dark-700 rounded-lg border border-dark-600">
      <table className="w-full text-xs border-collapse min-w-[560px]">
        <thead>
          <tr className="border-b border-dark-600 text-gray-500 sticky top-0 bg-dark-700">
            <th className="text-left px-2 py-1">#</th>
            <th className="text-left px-2 py-1">Time</th>
            <th className="text-left px-2 py-1">Mkt</th>
            <th className="text-left px-2 py-1">Side</th>
            <th className="text-right px-2 py-1">Entry</th>
            <th className="text-right px-2 py-1">Exit</th>
            <th className="text-right px-2 py-1">Qty</th>
            <th className="text-right px-2 py-1">Cost</th>
            <th className="text-right px-2 py-1">PnL</th>
            <th className="text-left px-2 py-1">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t, i) => {
            const isOpen = t.exitReason === "OPEN";
            const pnlColor = isOpen
              ? "text-gray-500 italic"
              : t.pnl == null
              ? "text-gray-500"
              : t.pnl >= 0
              ? "text-green-400"
              : "text-red-400";
            const reasonColor =
              t.exitReason === "STOP" ? "text-red-400" :
              t.exitReason === "RESOLVED" ? "text-blue-400" :
              "text-yellow-500";
            return (
              <tr key={t.id || i} className="border-b border-dark-700/60 hover:bg-dark-600/30">
                <td className="px-2 py-1 text-gray-600">{i + 1}</td>
                <td className="px-2 py-1 text-gray-400">{tradeTime(t.openedAt)}</td>
                <td className="px-2 py-1 text-gray-400 max-w-[70px] truncate" title={t.marketSlug}>
                  {shortSlug(t.marketSlug)}
                </td>
                <td className={`px-2 py-1 font-medium ${t.side === "Up" ? "text-green-400" : "text-red-400"}`}>
                  {t.side || "-"}
                </td>
                <td className="px-2 py-1 text-right text-gray-300">
                  {t.entryPrice != null ? `$${t.entryPrice.toFixed(3)}` : "-"}
                </td>
                <td className="px-2 py-1 text-right text-gray-300">
                  {t.exitPrice != null ? `$${t.exitPrice.toFixed(3)}` : <span className="text-gray-600">-</span>}
                </td>
                <td className="px-2 py-1 text-right text-gray-400">{t.qty ?? "-"}</td>
                <td className="px-2 py-1 text-right text-gray-400">
                  {t.cost != null ? `$${t.cost.toFixed(2)}` : "-"}
                </td>
                <td className={`px-2 py-1 text-right font-medium ${pnlColor}`}>
                  {isOpen ? "Open" : t.pnl == null ? "-" : `${t.pnl >= 0 ? "+" : ""}$${t.pnl.toFixed(2)}`}
                </td>
                <td className={`px-2 py-1 text-xs ${reasonColor}`}>{t.exitReason || "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Edge Analytics ───────────────────────────────────────────────────────────

function EdgeMetric({ label, value, color }) {
  return (
    <div className="bg-dark-700 border border-dark-600 rounded p-2 text-center">
      <div className="text-[10px] text-gray-500 mb-0.5">{label}</div>
      <div className={`text-sm font-semibold ${color || "text-gray-200"}`}>{value}</div>
    </div>
  );
}

function EdgeAnalytics({ trades, curve }) {
  const stats = useMemo(() => {
    const closed = (trades || []).filter((t) => t.exitReason !== "OPEN" && t.pnl != null);
    if (!closed.length) return null;

    const wins = closed.filter((t) => t.pnl > 0);
    const losses = closed.filter((t) => t.pnl <= 0);
    const winRate = wins.length / closed.length;
    const avgWin = wins.length ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length ? losses.reduce((s, t) => s + t.pnl, 0) / losses.length : 0;
    const expectancy = winRate * avgWin + (1 - winRate) * avgLoss;
    const sumWins = wins.reduce((s, t) => s + t.pnl, 0);
    const sumLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = sumLosses > 0 ? sumWins / sumLosses : null;

    // Max drawdown from curve
    let maxDD = 0;
    const pts = curve || [];
    if (pts.length > 1) {
      let peak = pts[0].equity;
      for (const pt of pts) {
        if (pt.equity > peak) peak = pt.equity;
        const dd = peak - pt.equity;
        if (dd > maxDD) maxDD = dd;
      }
    }

    return { expectancy, avgWin, avgLoss, profitFactor, maxDD, winRate, total: closed.length };
  }, [trades, curve]);

  if (!stats) {
    return (
      <div className="text-xs text-gray-600 italic mt-1">
        Edge analysis appears after first closed trade.
      </div>
    );
  }

  const { expectancy, avgWin, avgLoss, profitFactor, maxDD, winRate } = stats;
  const expColor = expectancy > 0 ? "text-green-400" : "text-red-400";
  const pfColor = profitFactor == null ? "text-gray-500" : profitFactor >= 1 ? "text-green-400" : "text-red-400";

  return (
    <div>
      <div className="text-[10px] text-gray-500 uppercase tracking-wider mb-1.5">Edge Analysis</div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <EdgeMetric
          label="Expectancy / trade"
          value={`${expectancy >= 0 ? "+" : ""}$${expectancy.toFixed(2)}`}
          color={expColor}
        />
        <EdgeMetric
          label="Avg Win"
          value={`+$${avgWin.toFixed(2)}`}
          color="text-green-400"
        />
        <EdgeMetric
          label="Avg Loss"
          value={`$${avgLoss.toFixed(2)}`}
          color="text-red-400"
        />
        <EdgeMetric
          label="Profit Factor"
          value={profitFactor != null ? profitFactor.toFixed(2) : "N/A"}
          color={pfColor}
        />
        <EdgeMetric
          label="Max Drawdown"
          value={maxDD > 0 ? `-$${maxDD.toFixed(2)}` : "$0.00"}
          color={maxDD > 0 ? "text-red-400" : "text-gray-400"}
        />
      </div>
    </div>
  );
}

// ─── Logs ─────────────────────────────────────────────────────────────────────

const LOG_ACTION_COLOR = {
  BUY: "text-green-400",
  STOP: "text-red-400",
  SETTLE: "text-blue-400",
  SKIP: "text-yellow-500",
  WAIT: "text-gray-500",
};

function PresetLogs({ logs }) {
  return (
    <div className="max-h-64 overflow-auto text-xs space-y-1 bg-dark-700 rounded-lg border border-dark-600 p-2">
      {!logs || !logs.length ? (
        <div className="text-gray-500">No log events yet.</div>
      ) : (
        logs.map((l, idx) => {
          const actionColor = LOG_ACTION_COLOR[l.action] || "text-accent-blue";
          return (
            <div key={`${l.ts}-${idx}`} className="flex gap-1.5 items-baseline">
              <span className="text-gray-600 shrink-0 w-16">
                {new Date(l.ts).toLocaleTimeString("en-US", { hour12: false })}
              </span>
              <span className={`font-semibold shrink-0 w-12 ${actionColor}`}>{l.action}</span>
              <span className="text-gray-300 break-all">{l.reason || `${l.side || ""} ${l.qty != null ? `×${l.qty}` : ""} ${l.price ? `@ $${l.price}` : ""}`}</span>
            </div>
          );
        })
      )}
    </div>
  );
}

// ─── Decision Inspector ───────────────────────────────────────────────────────

function DecisionInspector({ decision, config }) {
  if (!decision)
    return <div className="text-xs text-gray-500 p-2 italic">Waiting for decision tick...</div>;

  const fmtPct = (n) => (n * 100).toFixed(4) + "%";
  const fmtPrice = (n) => (n ? `$${n.toFixed(2)}` : "-");
  const rejection = decision.rejection;
  const statusColor = rejection ? "text-accent-red" : "text-accent-green";
  const statusText = rejection ? `REJECTED: ${rejection}` : `ACCEPTED: ${decision.action}`;

  return (
    <div className="bg-dark-800 border border-dark-600 rounded-lg p-3 text-xs space-y-2 mt-2 font-mono">
      <div className={`font-bold ${statusColor} border-b border-dark-600 pb-1`}>{statusText}</div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-gray-500 mb-1">Market State</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span className="text-gray-600">Window:</span>
            <span className={decision.secsLeft < 0 ? "text-red-400" : "text-gray-300"}>
              {decision.secsLeft ? `${Math.round(decision.secsLeft)}s left` : "N/A"}
            </span>
            <span className="text-gray-600">Cycle:</span>
            <span className="text-gray-300 truncate w-32" title={decision.constraints?.cycleKey}>
              {decision.constraints?.cycleKey?.split("-").pop() || "-"}
            </span>
            <span className="text-gray-600">Start $</span>
            <span className="text-gray-300">{fmtPrice(decision.startPrice)}</span>
            <span className="text-gray-600">Now $</span>
            <span className="text-gray-300">{fmtPrice(decision.symbolPrice)}</span>
            <span className="text-gray-600">Up Ask:</span>
            <span className="text-accent-blue">{fmtPrice(decision.upAsk)}</span>
            <span className="text-gray-600">Down Ask:</span>
            <span className="text-accent-red">{fmtPrice(decision.downAsk)}</span>
          </div>
        </div>
        <div>
          <div className="text-gray-500 mb-1">Logic Checks</div>
          <div className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
            <span className="text-gray-600">Diff:</span>
            <span className={Math.abs(decision.pctDiff) < config.buffer ? "text-red-400" : "text-green-400"}>
              {decision.pctDiff ? fmtPct(decision.pctDiff) : "-"}
            </span>
            <span className="text-gray-600">Buffer:</span>
            <span className="text-gray-400">&gt; {fmtPct(config.buffer)}</span>
            <span className="text-gray-600">Signal:</span>
            <span className={decision.confirms ? "text-green-400" : "text-red-400"}>
              {decision.marketSide || "-"} {decision.confirms ? "✓" : "✗"}
            </span>
            <span className="text-gray-600">Flags:</span>
            <span className="text-gray-400 flex gap-1">
              {decision.constraints?.pending && <span className="text-yellow-500" title="Pending">P</span>}
              {decision.constraints?.traded && <span className="text-blue-500" title="Traded">T</span>}
              {decision.constraints?.openPosition && <span className="text-purple-500" title="Open Pos">O</span>}
              {!decision.constraints?.pending && !decision.constraints?.traded && !decision.constraints?.openPosition && "-"}
            </span>
          </div>
        </div>
      </div>
      <div className="text-[10px] text-gray-600 text-right mt-1">
        Tick: {new Date(decision.ts).toLocaleTimeString()}
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function healthBadgeClass(status) {
  if (status === "Healthy") return "bg-green-900/40 text-green-300 border-green-700/50";
  if (status === "Degraded") return "bg-yellow-900/40 text-yellow-300 border-yellow-700/50";
  if (status === "Stale") return "bg-red-900/40 text-red-300 border-red-700/50";
  return "bg-dark-600 text-gray-300 border-dark-500";
}

function TabBtn({ active, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs rounded-t font-medium transition-colors ${
        active
          ? "bg-dark-600 text-gray-100 border-b-0"
          : "text-gray-500 hover:text-gray-300"
      }`}
    >
      {children}
    </button>
  );
}

// ─── Preset Card ─────────────────────────────────────────────────────────────

function PresetCard({
  preset,
  runningCount,
  maxActive,
  inspectId,
  setInspectId,
  updateLabPreset,
  startLabPreset,
  stopLabPreset,
  resetLabPreset,
  deleteLabPreset,
}) {
  const [tab, setTab] = useState("performance");
  const catLabel = (CATEGORIES.find((c) => c.id === preset.category) || {}).label || preset.category;
  const trades = preset.tradeHistory || [];

  return (
    <div className="card">
      {/* Header row */}
      <div className="flex flex-wrap gap-2 items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-gray-200">{preset.name}</div>
          <div className="text-xs text-gray-500">{catLabel}</div>
          <div className="mt-1 flex items-center gap-2">
            <span className={`text-[11px] px-2 py-0.5 rounded border ${healthBadgeClass(preset.dataHealth?.status)}`}>
              Data {preset.dataHealth?.status || "Booting"}
            </span>
            <span className="text-[11px] text-gray-500">{preset.dataHealth?.detail || "Waiting for feed..."}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {preset.running ? (
            <button className="btn bg-dark-600 text-gray-100" onClick={() => stopLabPreset(preset.id)}>
              Stop
            </button>
          ) : (
            <button
              className="btn bg-accent-green text-white"
              onClick={() => startLabPreset(preset.id)}
              disabled={runningCount >= maxActive}
            >
              Start
            </button>
          )}
          <button className="btn bg-dark-600 text-gray-100" onClick={() => resetLabPreset(preset.id)}>
            Reset
          </button>
          <button
            className={`btn ${inspectId === preset.id ? "bg-accent-blue text-white" : "bg-dark-600 text-gray-100"}`}
            onClick={() => setInspectId(inspectId === preset.id ? null : preset.id)}
          >
            Inspect
          </button>
          <button className="btn btn-danger" onClick={() => deleteLabPreset(preset.id)}>
            Delete
          </button>
        </div>
      </div>

      {/* Inspector panel */}
      {inspectId === preset.id && (
        <DecisionInspector decision={preset.latestDecision} config={preset.config} />
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mb-3 text-xs">
        <div className="bg-dark-700 border border-dark-600 rounded p-2">
          <div className="text-gray-500">Cash</div>
          <div className="text-gray-200 font-medium">${preset.cash.toFixed(2)}</div>
        </div>
        <div className="bg-dark-700 border border-dark-600 rounded p-2">
          <div className="text-gray-500">Equity</div>
          <div className="text-gray-200 font-medium">${preset.equity.toFixed(2)}</div>
        </div>
        <div className="bg-dark-700 border border-dark-600 rounded p-2">
          <div className="text-gray-500">PnL</div>
          <div className={`font-medium ${preset.pnl >= 0 ? "text-green-400" : "text-red-400"}`}>
            {preset.pnl >= 0 ? "+" : ""}${preset.pnl.toFixed(2)}
          </div>
        </div>
        <div className="bg-dark-700 border border-dark-600 rounded p-2">
          <div className="text-gray-500">Win rate</div>
          <div className="text-gray-200 font-medium">{preset.winRate.toFixed(1)}%</div>
        </div>
        <div className="bg-dark-700 border border-dark-600 rounded p-2">
          <div className="text-gray-500">Trades</div>
          <div className="text-gray-200 font-medium">{preset.trades}</div>
        </div>
        <div className="bg-dark-700 border border-dark-600 rounded p-2">
          <div className="text-gray-500">Stop hits</div>
          <div className="text-gray-200 font-medium">{preset.stopLossHits}</div>
        </div>
      </div>

      {/* Config row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-3">
        <div>
          <label className="text-xs text-gray-500">Bet size ($)</label>
          <input
            className="input-field"
            type="number"
            value={preset.config.betSize}
            onChange={(e) =>
              updateLabPreset(preset.id, { config: { betSize: parseFloat(e.target.value || "0") } })
            }
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">Min price</label>
          <input
            className="input-field"
            type="number"
            step="0.01"
            value={preset.config.minPrice}
            onChange={(e) =>
              updateLabPreset(preset.id, { config: { minPrice: parseFloat(e.target.value || "0") } })
            }
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">Buffer</label>
          <input
            className="input-field"
            type="number"
            step="0.0001"
            value={preset.config.buffer}
            onChange={(e) =>
              updateLabPreset(preset.id, { config: { buffer: parseFloat(e.target.value || "0") } })
            }
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">Stop loss</label>
          <input
            className="input-field"
            type="number"
            step="0.01"
            value={preset.config.stopLoss}
            onChange={(e) =>
              updateLabPreset(preset.id, { config: { stopLoss: parseFloat(e.target.value || "0") } })
            }
          />
        </div>
        <div>
          <label className="text-xs text-gray-500">Window sec</label>
          <input
            className="input-field"
            type="number"
            value={preset.config.windowSec}
            onChange={(e) =>
              updateLabPreset(preset.id, { config: { windowSec: parseInt(e.target.value || "0", 10) } })
            }
          />
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-dark-600 mb-3">
        <TabBtn active={tab === "performance"} onClick={() => setTab("performance")}>Performance</TabBtn>
        <TabBtn active={tab === "trades"} onClick={() => setTab("trades")}>
          Trades {trades.length > 0 && <span className="text-gray-600">({trades.length})</span>}
        </TabBtn>
        <TabBtn active={tab === "logs"} onClick={() => setTab("logs")}>Logs</TabBtn>
      </div>

      {/* Performance tab */}
      {tab === "performance" && (
        <div className="space-y-3">
          <PresetChart curve={preset.curve} startingCash={preset.startingCash} />
          <EdgeAnalytics trades={trades} curve={preset.curve} />
        </div>
      )}

      {/* Trades tab */}
      {tab === "trades" && (
        <TradeHistoryTable trades={trades} />
      )}

      {/* Logs tab */}
      {tab === "logs" && (
        <PresetLogs logs={preset.logs} />
      )}
    </div>
  );
}

// ─── Main Tab ─────────────────────────────────────────────────────────────────

export default function StrategyLabTab({
  lab,
  createLabPreset,
  updateLabPreset,
  startLabPreset,
  stopLabPreset,
  resetLabPreset,
  deleteLabPreset,
  exportLabPresets,
  importLabPresets,
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("btc5m");
  const [startingCash, setStartingCash] = useState(String(lab?.defaultStartingCash || 1000));
  const [inspectId, setInspectId] = useState(null);
  const fileInputRef = useRef(null);
  const presets = lab?.presets || [];
  const runningCount = presets.filter((p) => p.running).length;
  const maxActive = lab?.maxActive || 3;

  const handleCreate = async () => {
    await createLabPreset({
      name: name || undefined,
      category,
      startingCash: parseFloat(startingCash || "1000"),
    });
    setName("");
  };

  const handleExport = async () => {
    const payload = await exportLabPresets();
    if (!payload) return;
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `strategy-lab-presets-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (event) => {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      await importLabPresets(json, "merge");
    } catch (err) {
      console.error("Import failed:", err);
    } finally {
      event.target.value = "";
    }
  };

  return (
    <div className="space-y-4">
      {/* Create preset panel */}
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wider mb-3">
          Strategy Lab
        </h2>
        <div className="flex flex-wrap gap-2 mb-3">
          <button className="btn bg-dark-700 text-gray-100" onClick={handleExport}>
            Export presets
          </button>
          <button className="btn bg-dark-700 text-gray-100" onClick={() => fileInputRef.current?.click()}>
            Import presets
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <div className="md:col-span-2">
            <label className="text-xs text-gray-500">Preset name</label>
            <input
              className="input-field"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Momentum 5m A"
            />
          </div>
          <div>
            <label className="text-xs text-gray-500">Category</label>
            <select
              className="input-field"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500">Virtual cash</label>
            <input
              className="input-field"
              type="number"
              value={startingCash}
              onChange={(e) => setStartingCash(e.target.value)}
            />
          </div>
          <button className="btn bg-accent-blue hover:opacity-90 text-white" onClick={handleCreate}>
            Create preset
          </button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Running: {runningCount}/{maxActive}. One order per market cycle. Performance, trade history, and edge analytics per preset.
        </p>
      </div>

      {/* Preset cards */}
      <div className="space-y-4">
        {presets.map((preset) => (
          <PresetCard
            key={preset.id}
            preset={preset}
            runningCount={runningCount}
            maxActive={maxActive}
            inspectId={inspectId}
            setInspectId={setInspectId}
            updateLabPreset={updateLabPreset}
            startLabPreset={startLabPreset}
            stopLabPreset={stopLabPreset}
            resetLabPreset={resetLabPreset}
            deleteLabPreset={deleteLabPreset}
          />
        ))}
      </div>
    </div>
  );
}
