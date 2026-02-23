import React from "react";

function formatPrice(price) {
  if (!price) return "$0.00";
  return "$" + price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function Header({ btcPrice, balance, connected }) {
  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-dark-600 bg-dark-800/50 backdrop-blur-sm">
      <div className="flex items-center gap-4">
        <h1 className="text-lg font-bold tracking-tight">
          <span className="text-accent-purple">POLY</span>
          <span className="text-gray-300">BOT</span>
        </h1>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${connected ? "bg-accent-green animate-pulse" : "bg-red-500"}`} />
          <span className="text-xs text-gray-500">
            {connected ? "Live" : "Disconnected"}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-8">
        <div className="text-right">
          <div className="text-xs text-gray-500 uppercase tracking-wider">BTC</div>
          <div className="text-xl font-bold text-accent-yellow tabular-nums">
            {formatPrice(btcPrice)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-xs text-gray-500 uppercase tracking-wider">Balance</div>
          <div className="text-xl font-bold text-gray-100 tabular-nums">
            {formatPrice(balance)} <span className="text-xs text-gray-500">USDC</span>
          </div>
        </div>
      </div>
    </header>
  );
}
