import React, { useEffect, useState } from "react";

function fmtPrice(p) {
  if (p === null || p === undefined) return "—";
  return "$" + p.toFixed(4);
}

function useCountdown(resolutionTime) {
  const [text, setText] = useState("");

  useEffect(() => {
    function update() {
      if (!resolutionTime) { setText("—"); return; }
      const diff = resolutionTime - Date.now();
      if (diff <= 0) { setText("Resolved"); return; }
      const mins = Math.floor(diff / 60000);
      const secs = Math.floor((diff % 60000) / 1000);
      setText(`${mins}:${secs.toString().padStart(2, "0")}`);
    }
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [resolutionTime]);

  return text;
}

function MarketRow({ m }) {
  const countdown = useCountdown(m.resolutionTime);
  const combined = m.combined;
  const isArb = combined !== null && combined < 1.0;

  return (
    <div className="flex items-center justify-between bg-dark-700 rounded-lg px-4 py-3 border border-dark-600 hover:border-dark-600/80 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-200 truncate">
          {m.question || m.slug}
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
          {m.startPrice && (
            <span>Start: ${m.startPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
          )}
          <span className="tabular-nums">{countdown}</span>
          {m.windowLabel && (
            <span className="px-1.5 py-0.5 rounded bg-dark-600 text-gray-400 text-[10px] uppercase">
              {m.windowLabel}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-4 ml-4">
        <div className="text-right">
          <div className="text-xs text-gray-500">UP</div>
          <div className="text-sm font-semibold text-accent-green tabular-nums">
            {fmtPrice(m.upAsk)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500">DOWN</div>
          <div className="text-sm font-semibold text-accent-red tabular-nums">
            {fmtPrice(m.downAsk)}
          </div>
        </div>
        <div className="text-right min-w-[80px]">
          <div className="text-xs text-gray-500">Combined</div>
          <div className="flex items-center gap-1.5 justify-end">
            <span className={`text-sm font-semibold tabular-nums ${isArb ? "text-accent-green" : "text-gray-400"}`}>
              {combined !== null ? "$" + combined.toFixed(4) : "—"}
            </span>
            {isArb && <span className="arb-badge">ARB</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MarketList({ markets }) {
  if (!markets || !markets.length) {
    return (
      <div className="card">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Active Markets
        </h2>
        <div className="text-center py-8 text-gray-600 text-sm">
          No active BTC 5m/15m markets found. Scanning...
        </div>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
        Active Markets
      </h2>
      <div className="space-y-2">
        {markets.map((m) => (
          <MarketRow key={m.id} m={m} />
        ))}
      </div>
    </div>
  );
}
