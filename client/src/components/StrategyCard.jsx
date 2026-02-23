import React, { useState, useEffect } from "react";

function Toggle({ enabled, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className={`toggle ${enabled ? "bg-accent-green" : "bg-dark-600"}`}
    >
      <span
        className={`toggle-dot ${enabled ? "translate-x-5" : "translate-x-1"}`}
      />
    </button>
  );
}

function Field({ label, value, onChange, type = "text", step }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label className="text-xs text-gray-500 whitespace-nowrap">{label}</label>
      <input
        type={type}
        step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field w-24 text-right text-xs"
      />
    </div>
  );
}

function Checkbox({ label, checked, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-gray-500">{label}</span>
      <button
        onClick={() => onChange(!checked)}
        className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
          checked
            ? "bg-accent-blue border-accent-blue"
            : "bg-dark-700 border-dark-600"
        }`}
      >
        {checked && (
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        )}
      </button>
    </div>
  );
}

export default function StrategyCard({
  title,
  color,
  strategy,
  fields,
  onToggle,
  onConfigChange,
}) {
  const [localFields, setLocalFields] = useState({});

  useEffect(() => {
    if (strategy) {
      const init = {};
      fields.forEach((f) => {
        init[f.key] = strategy[f.key];
      });
      setLocalFields(init);
    }
  }, [strategy, fields]);

  if (!strategy) return null;

  const colorMap = {
    blue: "border-blue-500/30",
    green: "border-green-500/30",
    purple: "border-purple-500/30",
  };

  const handleFieldChange = (key, value) => {
    setLocalFields((prev) => ({ ...prev, [key]: value }));
    const update = {};
    if (key === "dryRun") {
      update[key] = value;
    } else {
      update[key] = parseFloat(value);
    }
    onConfigChange(update);
  };

  const statusColor =
    strategy.status === "Disabled"
      ? "text-gray-600"
      : strategy.status === "Watching"
      ? "text-accent-yellow"
      : strategy.status === "STOPPED"
      ? "text-red-500"
      : "text-accent-green";

  return (
    <div className={`card border ${colorMap[color] || "border-dark-600"}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-gray-300">
          {title}
        </h3>
        <Toggle enabled={strategy.enabled} onToggle={onToggle} />
      </div>

      <div className="space-y-2.5 mb-4">
        {fields.map((f) =>
          f.type === "checkbox" ? (
            <Checkbox
              key={f.key}
              label={f.label}
              checked={localFields[f.key] ?? false}
              onChange={(val) => handleFieldChange(f.key, val)}
            />
          ) : (
            <Field
              key={f.key}
              label={f.label}
              value={localFields[f.key] ?? ""}
              onChange={(val) => handleFieldChange(f.key, val)}
              type="number"
              step={f.step}
            />
          )
        )}
      </div>

      <div className="border-t border-dark-600 pt-3 space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Status</span>
          <span className={`text-xs font-medium ${statusColor}`}>
            {strategy.status}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-gray-500">Today</span>
          <span className="text-xs text-gray-300 tabular-nums">
            {strategy.wins}W / {strategy.losses}L
            <span className={`ml-2 font-semibold ${strategy.pnl >= 0 ? "text-accent-green" : "text-accent-red"}`}>
              {strategy.pnl >= 0 ? "+" : ""}${strategy.pnl.toFixed(2)}
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
