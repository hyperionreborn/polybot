const express = require("express");

/**
 * REST API routes for bot control.
 */
function createRouter(store, executor, sniperStrategy, hedgeStrategy, labEngine) {
  const router = express.Router();

  router.get("/status", (req, res) => {
    res.json(store.getStatus());
  });

  router.post("/sniper/toggle", (req, res) => {
    store.sniper.enabled = !store.sniper.enabled;
    const state = store.sniper.enabled ? "ON" : "OFF";
    store.addLog({ strategy: "SNIPER", action: "TOGGLE", state });
    res.json({ enabled: store.sniper.enabled });
  });

  router.post("/hedge/toggle", (req, res) => {
    store.hedge.enabled = !store.hedge.enabled;
    const state = store.hedge.enabled ? "ON" : "OFF";
    store.addLog({ strategy: "HEDGE", action: "TOGGLE", state });
    res.json({ enabled: store.hedge.enabled });
  });

  router.put("/config", (req, res) => {
    const { sniper, hedge } = req.body;

    if (sniper) {
      if (sniper.minPrice !== undefined) store.sniper.minPrice = parseFloat(sniper.minPrice);
      if (sniper.maxPrice !== undefined) store.sniper.maxPrice = parseFloat(sniper.maxPrice);
      if (sniper.betSize !== undefined) store.sniper.betSize = parseFloat(sniper.betSize);
      if (sniper.buffer !== undefined) store.sniper.buffer = parseFloat(sniper.buffer);
      if (sniper.windowSec !== undefined) store.sniper.windowSec = parseInt(sniper.windowSec, 10);
      if (sniper.cooldown !== undefined) store.sniper.cooldown = parseInt(sniper.cooldown, 10);
      if (sniper.stopLoss !== undefined) store.sniper.stopLoss = parseFloat(sniper.stopLoss);
      if (sniper.dryRun !== undefined) store.sniper.dryRun = Boolean(sniper.dryRun);
    }

    if (hedge) {
      if (hedge.maxCombined !== undefined) store.hedge.maxCombined = parseFloat(hedge.maxCombined);
      if (hedge.betSize !== undefined) store.hedge.betSize = parseFloat(hedge.betSize);
      if (hedge.maxSinglePrice !== undefined) store.hedge.maxSinglePrice = parseFloat(hedge.maxSinglePrice);
      if (hedge.dryRun !== undefined) store.hedge.dryRun = Boolean(hedge.dryRun);
    }

    store.addLog({ strategy: "SYSTEM", action: "CONFIG_UPDATE", sniper: store.sniper, hedge: store.hedge });
    res.json({ sniper: store.sniper, hedge: store.hedge });
  });

  router.post("/emergency-stop", async (req, res) => {
    store.sniper.enabled = false;
    store.hedge.enabled = false;
    store.sniper.status = "STOPPED";
    store.hedge.status = "STOPPED";

    let cancelled = 0;
    try {
      cancelled = await executor.cancelAll();
    } catch {}

    store.addLog({ strategy: "SYSTEM", action: "EMERGENCY_STOP", cancelledOrders: cancelled });
    res.json({ stopped: true, cancelledOrders: cancelled });
  });

  router.get("/lab/categories", (req, res) => {
    res.json({ categories: labEngine.getCategories() });
  });

  router.get("/lab/presets", (req, res) => {
    res.json(labEngine.getStatus());
  });

  router.get("/lab/presets/export", (req, res) => {
    res.json(labEngine.exportPresets());
  });

  router.post("/lab/presets/import", (req, res) => {
    try {
      const mode = req.body?.mode === "replace" ? "replace" : "merge";
      const status = labEngine.importPresets(req.body || {}, { mode });
      return res.status(201).json(status);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  router.post("/lab/presets", (req, res) => {
    const preset = labEngine.createPreset(req.body || {});
    res.status(201).json({ preset });
  });

  router.put("/lab/presets/:id", (req, res) => {
    const preset = labEngine.updatePreset(req.params.id, req.body || {});
    if (!preset) return res.status(404).json({ error: "Preset not found" });
    res.json({ preset });
  });

  router.post("/lab/presets/:id/start", (req, res) => {
    try {
      const preset = labEngine.setPresetRunning(req.params.id, true);
      if (!preset) return res.status(404).json({ error: "Preset not found" });
      return res.json({ preset });
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  });

  router.post("/lab/presets/:id/stop", (req, res) => {
    const preset = labEngine.setPresetRunning(req.params.id, false);
    if (!preset) return res.status(404).json({ error: "Preset not found" });
    res.json({ preset });
  });

  router.post("/lab/presets/:id/reset", (req, res) => {
    const preset = labEngine.resetPreset(req.params.id);
    if (!preset) return res.status(404).json({ error: "Preset not found" });
    res.json({ preset });
  });

  router.delete("/lab/presets/:id", (req, res) => {
    labEngine.deletePreset(req.params.id);
    res.status(204).end();
  });

  return router;
}

module.exports = createRouter;
