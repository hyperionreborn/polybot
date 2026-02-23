import React, { useState } from "react";

export default function EmergencyStop({ onStop }) {
  const [confirming, setConfirming] = useState(false);

  const handleClick = () => {
    if (confirming) {
      onStop();
      setConfirming(false);
    } else {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
    }
  };

  return (
    <button
      onClick={handleClick}
      className={`btn-danger w-full text-center py-3 text-base tracking-wider ${
        confirming ? "bg-red-500 animate-pulse ring-2 ring-red-400" : ""
      }`}
    >
      {confirming ? "CONFIRM EMERGENCY STOP" : "EMERGENCY STOP"}
    </button>
  );
}
