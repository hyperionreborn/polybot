import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";

// In dev, Vite runs on :3001 but the backend is on :3000.
// In production, both are served from the same origin.
function getSocketUrl() {
  if (import.meta.env.VITE_SOCKET_URL) return import.meta.env.VITE_SOCKET_URL;
  if (import.meta.env.DEV) return "http://localhost:3000";
  return window.location.origin;
}

export default function useSocket() {
  const socketRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [btcPrice, setBtcPrice] = useState(0);
  const [markets, setMarkets] = useState([]);
  const [status, setStatus] = useState(null);
  const [logs, setLogs] = useState([]);
  const [lab, setLab] = useState({ presets: [], maxActive: 3, defaultStartingCash: 1000 });
  const priceRef = useRef(0);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/status");
      const data = await res.json();
      setStatus(data);
      if (data.btcPrice) {
        setBtcPrice(data.btcPrice);
        priceRef.current = data.btcPrice;
      }
      if (data.markets) setMarkets(data.markets);
      if (data.logs) setLogs(data.logs);
      if (data.lab) setLab(data.lab);
    } catch {}
  }, []);

  useEffect(() => {
    const url = getSocketUrl();
    console.log("[WS] Connecting to", url);

    const socket = io(url, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 10000,
    });
    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("[WS] Connected:", socket.id);
      setConnected(true);
    });

    socket.on("disconnect", (reason) => {
      console.log("[WS] Disconnected:", reason);
      setConnected(false);
    });

    socket.on("connect_error", (err) => {
      console.log("[WS] Connection error:", err.message);
      setConnected(false);
    });

    socket.on("price", (price) => {
      if (typeof price === "number" && price > 0) {
        setBtcPrice(price);
        priceRef.current = price;
      }
    });

    socket.on("markets", (mkts) => {
      if (Array.isArray(mkts)) setMarkets(mkts);
    });

    socket.on("status", (s) => {
      if (s) {
        setStatus(s);
        if (s.logs) setLogs(s.logs);
        if (s.lab) setLab(s.lab);
      }
    });

    socket.on("lab", (payload) => {
      if (payload) setLab(payload);
    });

    socket.on("log", (entry) => {
      setLogs((prev) => [entry, ...prev].slice(0, 100));
    });

    socket.on("trade", () => {
      fetchStatus();
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, [fetchStatus]);

  // REST polling as fallback — every 2s to keep things fresh
  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  return { connected, btcPrice, markets, status, logs, lab, fetchStatus };
}
