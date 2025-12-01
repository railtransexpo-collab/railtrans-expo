const express = require("express");
const router = express.Router();
const db = require("../db");

/**
 * Normalize / canonicalize config shape used by frontends.
 * Ensures fields have name/label/options and backgroundMedia/terms keys are consistent.
 */
function canonicalizeConfig(cfg = {}) {
  const config = { ...(typeof cfg === "object" && cfg !== null ? cfg : {}) };

  config.fields = Array.isArray(config.fields)
    ? config.fields.map(f => {
        const ff = typeof f === "object" && f ? { ...f } : {};
        ff.name = (ff.name || "").trim();
        ff.label = (ff.label || "").trim();
        ff.type = (ff.type || "text").trim();
        if (["select", "radio"].includes(ff.type)) {
          ff.options = Array.isArray(ff.options) ? ff.options.map(o => (o == null ? "" : String(o))) : [""];
        } else {
          ff.options = Array.isArray(ff.options) ? ff.options : [];
        }
        // keep meta as-is if present (but ensure object)
        if (ff.meta && typeof ff.meta !== "object") {
          try { ff.meta = JSON.parse(String(ff.meta)); } catch { ff.meta = undefined; }
        }
        return ff;
      }).filter(f => f.name && f.label)
    : [];

  config.images = Array.isArray(config.images) ? config.images : [];
  config.eventDetails = typeof config.eventDetails === "object" && config.eventDetails !== null ? config.eventDetails : {};

  // background media normalization (accept many legacy keys)
  let bg = config.backgroundMedia || config.background_media || config.backgroundVideo || config.background_video || config.backgroundImage || config.background_image || "";
  if (typeof bg === "object" && bg !== null) {
    config.backgroundMedia = { type: (bg.type || "image"), url: (bg.url || "") };
  } else if (typeof bg === "string" && bg.trim()) {
    const url = bg.trim();
    const isVideo = /\.(mp4|webm|ogg)(\?|$)/i.test(url) || /video/i.test(url);
    config.backgroundMedia = { type: isVideo ? "video" : "image", url };
  } else {
    config.backgroundMedia = { type: "image", url: "" };
  }

  config.termsUrl = config.termsUrl || config.terms_url || config.terms || "";
  config.termsLabel = config.termsLabel || config.terms_label || "Terms & Conditions";
  config.termsRequired = !!config.termsRequired || !!config.terms_required;
  config.backgroundColor = config.backgroundColor || config.background_color || "#ffffff";
  config.badgeTemplateUrl = config.badgeTemplateUrl || config.badge_template_url || config.badgeTemplate || "";
  config.banner = config.banner || config.headerBanner || "";
  config.hostedByLogo = config.hostedByLogo || config.hosted_by_logo || "";

  return config;
}

/**
 * GET /api/visitor-config
 * Returns canonicalized config (safe shape) so frontends don't receive defaults accidentally.
 */
router.get("/", async (req, res) => {
  try {
    console.log("HIT")
    const dbResult = await db.execute(
      "SELECT config_json FROM registration_page_config_visitor WHERE page = ? LIMIT 1",
      ["visitor"]
    );

    // db.execute may return [rows, fields] or rows directly
    let rows = Array.isArray(dbResult) ? dbResult[0] : dbResult;

    let configJson;
    if (Array.isArray(rows)) {
      if (!rows.length || !rows[0].config_json) return res.json({ fields: [], images: [], eventDetails: {} });
      configJson = rows[0].config_json;
    } else if (rows && rows.config_json) {
      configJson = rows.config_json;
    } else {
      return res.json({ fields: [], images: [], eventDetails: {} });
    }

    let config;
    if (typeof configJson === "object" && configJson !== null) {
      config = configJson;
    } else {
      try {
        config = JSON.parse(String(configJson || ""));
      } catch (e) {
        console.warn("Failed to parse config_json, returning defaults.", e && e.message ? e.message : e);
        return res.json({ fields: [], images: [], eventDetails: {} });
      }
    }

    const out = canonicalizeConfig(config);
    console.log("Visitor config served:", out);
    return res.json(out);
  } catch (err) {
    console.error("General error in visitor config route:", err && err.stack ? err.stack : err);
    return res.json({ fields: [], images: [], eventDetails: {} });
  }
});

/**
 * GET /api/visitor-config/raw
 * Debug endpoint - returns the raw DB value saved in config_json column (string or object)
 */
router.get("/raw", async (req, res) => {
  try {
    const dbResult = await db.execute(
      "SELECT config_json FROM registration_page_config_visitor WHERE page = ? LIMIT 1",
      ["visitor"]
    );
    let rows = Array.isArray(dbResult) ? dbResult[0] : dbResult;
    if (Array.isArray(rows)) {
      if (!rows.length) return res.json({ raw: null });
      return res.json({ raw: rows[0].config_json });
    } else if (rows && rows.config_json) {
      return res.json({ raw: rows.config_json });
    } else {
      return res.json({ raw: null });
    }
  } catch (err) {
    console.error("Error reading raw config:", err && err.stack ? err.stack : err);
    return res.status(500).json({ error: "Failed to read raw config" });
  }
});

/**
 * POST /api/visitor-config/config
 * - Accepts config from admin, canonicalizes it, upserts into DB, and returns saved canonicalized config.
 */
router.post("/config", async (req, res) => {
  try {
    const incoming = req.body;
    const canonical = canonicalizeConfig(incoming || {});
    const json = JSON.stringify(canonical);

    // Try UPDATE first (common case where row exists)
    const updResult = await db.execute(
      "UPDATE registration_page_config_visitor SET config_json = ? WHERE page = ?",
      [json, "visitor"]
    );
    // normalize result
    const upd = Array.isArray(updResult) ? updResult[0] : updResult;
    const affected = (upd && typeof upd.affectedRows === "number") ? upd.affectedRows : null;

    if (!affected || affected === 0) {
      // try insert or insert-or-update
      try {
        await db.execute(
          "INSERT INTO registration_page_config_visitor (`page`, `config_json`) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_json = VALUES(config_json)",
          ["visitor", json]
        );
      } catch (e) {
        // fallback: try simple insert (in case ON DUPLICATE KEY not supported)
        try {
          await db.execute("INSERT IGNORE INTO registration_page_config_visitor (`page`, `config_json`) VALUES (?, ?)", ["visitor", json]);
        } catch (ie) {
          console.error("Insert fallback failed:", ie && ie.stack ? ie.stack : ie);
          return res.status(500).json({ error: "Failed to save config" });
        }
      }
    }

    // Return canonicalized config that was saved
    return res.json({ success: true, config: canonical });
  } catch (err) {
    console.error("Config update error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ error: "Database update failed" });
  }
});

router.delete("/", async (req, res) => {
  try {
    await db.execute(
      "DELETE FROM registration_page_config_visitor WHERE page = ?",
      ["visitor"]
    );
    return res.json({ success: true, message: "Visitor config deleted." });
  } catch (err) {
    console.error("Config delete error:", err && err.stack ? err.stack : err);
    return res.status(500).json({ error: "Database delete failed" });
  }
});

module.exports = router;