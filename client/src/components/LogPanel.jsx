import React from "react";

function formatTs(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour12: false });
}

function actionColor(action) {
  switch (action) {
    case "BUY":
    case "FILLED":
    case "DRY_RUN":
      return "text-accent-green";
    case "SKIP":
      return "text-gray-500";
    case "FAILED":
    case "ORDER_ERROR":
    case "EMERGENCY_STOP":
      return "text-accent-red";
    case "TOGGLE":
    case "CONFIG_UPDATE":
      return "text-accent-blue";
    default:
      return "text-gray-400";
  }
}

function strategyColor(strategy) {
  switch (strategy) {
    case "SNIPER":
      return "text-accent-blue";
    case "HEDGE":
      return "text-accent-green";
    case "SYSTEM":
      return "text-accent-purple";
    default:
      return "text-gray-400";
  }
}

function formatLogLine(entry) {
  const parts = [];

  if (entry.side) parts.push(entry.side);
  if (entry.qty) parts.push(`${entry.qty}`);
  if (entry.price) parts.push(`@ $${entry.price.toFixed(4)}`);
  if (entry.profit !== undefined) {
    parts.push(entry.profit >= 0 ? `+$${entry.profit.toFixed(2)}` : `-$${Math.abs(entry.profit).toFixed(2)}`);
  }
  if (entry.reason) parts.push(entry.reason);
  if (entry.state) parts.push(entry.state);
  if (entry.market) parts.push(`— ${entry.market}`);

  return parts.join(" ");
}

export default function LogPanel({ logs }) {
  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Log
      </h2>
      <div className="max-h-64 overflow-y-auto space-y-0.5">
        {(!logs || logs.length === 0) ? (
          <div className="text-center py-8 text-gray-600 text-sm">
            No activity yet. Enable a strategy to start.
          </div>
        ) : (
          logs.map((entry, i) => (
            <div
              key={`${entry.ts}-${i}`}
              className="flex items-start gap-2 py-1 px-2 rounded hover:bg-dark-700/50 transition-colors text-xs"
            >
              <span className="text-gray-600 tabular-nums whitespace-nowrap">
                {formatTs(entry.ts)}
              </span>
              <span className={`font-semibold w-14 ${strategyColor(entry.strategy)}`}>
                {entry.strategy}
              </span>
              <span className={`font-medium w-16 ${actionColor(entry.action)}`}>
                {entry.action}
              </span>
              <span className="text-gray-400 truncate flex-1">
                {formatLogLine(entry)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
