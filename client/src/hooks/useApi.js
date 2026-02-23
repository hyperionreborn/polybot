import { useCallback } from "react";

export default function useApi(fetchStatus) {
  const post = useCallback(async (url, body) => {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      fetchStatus();
      return data;
    } catch (err) {
      console.error("API error:", err);
      return null;
    }
  }, [fetchStatus]);

  const put = useCallback(async (url, body) => {
    try {
      const res = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      fetchStatus();
      return data;
    } catch (err) {
      console.error("API error:", err);
      return null;
    }
  }, [fetchStatus]);

  const get = useCallback(async (url) => {
    try {
      const res = await fetch(url);
      return await res.json();
    } catch (err) {
      console.error("API error:", err);
      return null;
    }
  }, []);

  const toggleSniper = () => post("/api/sniper/toggle");
  const toggleHedge = () => post("/api/hedge/toggle");
  const emergencyStop = () => post("/api/emergency-stop");
  const updateConfig = (cfg) => put("/api/config", cfg);
  const createLabPreset = (payload) => post("/api/lab/presets", payload);
  const updateLabPreset = (id, payload) => put(`/api/lab/presets/${id}`, payload);
  const startLabPreset = (id) => post(`/api/lab/presets/${id}/start`);
  const stopLabPreset = (id) => post(`/api/lab/presets/${id}/stop`);
  const resetLabPreset = (id) => post(`/api/lab/presets/${id}/reset`);
  const exportLabPresets = () => get("/api/lab/presets/export");
  const importLabPresets = (payload, mode = "merge") => post("/api/lab/presets/import", { ...payload, mode });
  const deleteLabPreset = async (id) => {
    try {
      const res = await fetch(`/api/lab/presets/${id}`, { method: "DELETE" });
      fetchStatus();
      return res.ok;
    } catch (err) {
      console.error("API error:", err);
      return false;
    }
  };

  return {
    toggleSniper,
    toggleHedge,
    emergencyStop,
    updateConfig,
    createLabPreset,
    updateLabPreset,
    startLabPreset,
    stopLabPreset,
    resetLabPreset,
    exportLabPresets,
    importLabPresets,
    deleteLabPreset,
  };
}
