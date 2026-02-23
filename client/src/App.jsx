import React from "react";
import useSocket from "./hooks/useSocket";
import useApi from "./hooks/useApi";
import Header from "./components/Header";
import MarketList from "./components/MarketList";
import StrategyCard from "./components/StrategyCard";
import LogPanel from "./components/LogPanel";
import EmergencyStop from "./components/EmergencyStop";

const SNIPER_FIELDS = [
  { key: "minPrice", label: "Min price", step: "0.01" },
  { key: "maxPrice", label: "Max price", step: "0.01" },
  { key: "betSize", label: "Bet size ($)", step: "10" },
  { key: "buffer", label: "Buffer (%)", step: "0.0001" },
  { key: "windowSec", label: "Window (sec)", step: "5" },
  { key: "cooldown", label: "Cooldown (sec)", step: "1" },
  { key: "stopLoss", label: "Stop Loss ($)", step: "0.01" },
  { key: "dryRun", label: "Dry run", type: "checkbox" },
];


export default function App() {
  const { connected, btcPrice, markets, status, logs, fetchStatus } = useSocket();
  const { toggleSniper, emergencyStop, updateConfig } = useApi(fetchStatus);

  const sniper = status?.sniper || null;
  const balance = status?.balance || 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Header btcPrice={btcPrice} balance={balance} connected={connected} />

      <main className="flex-1 p-4 md:p-6 space-y-4 max-w-6xl mx-auto w-full">
        <MarketList markets={markets} />

        <StrategyCard
          title="Sniper"
          color="blue"
          strategy={sniper}
          fields={SNIPER_FIELDS}
          onToggle={toggleSniper}
          onConfigChange={(update) => updateConfig({ sniper: update })}
        />

        <LogPanel logs={logs} />
        <EmergencyStop onStop={emergencyStop} />
      </main>

      <footer className="text-center text-xs text-gray-700 py-3 border-t border-dark-600">
        Polymarket BTC Bot &middot; Dry run {sniper?.dryRun ? "ON" : "OFF"} &middot; Not financial advice
      </footer>
    </div>
  );
}
