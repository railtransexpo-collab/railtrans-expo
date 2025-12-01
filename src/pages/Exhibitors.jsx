import React, { useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import ThankYouMessage from "../components/ThankYouMessage";

/*
  Exhibitors.jsx
  - Uses a dynamic API base resolution (process.env.REACT_APP_API_BASE, window.__API_BASE__,
    or window.__CONFIG__.backendUrl when available) instead of a hardcoded localhost.
  - Fetches exhibitor config from `${apiBase}/api/exhibitor-config`
  - Passes admin-provided config.fields through unchanged to DynamicRegistrationForm
  - Supports backgroundMedia (image or video) and Terms & Conditions
  - Hides image slider when images array is empty
  - Best-effort video play with graceful fallback when autoplay is blocked
*/


/* ---------- Dynamic API base helpers ---------- */
function getApiBaseFromEnvOrWindow() {
  // Priority:
  // 1. process.env.REACT_APP_API_BASE (build-time)
  // 2. window.__API_BASE__ (runtime injected)
  // 3. window.__CONFIG__?.backendUrl (runtime config loaded into page)
  // 4. fallback to a sensible placeholder (not localhost)
  if (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) {
    return process.env.REACT_APP_API_BASE.replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.__API_BASE__) {
    return String(window.__API_BASE__).replace(/\/$/, "");
  }
  if (typeof window !== "undefined" && window.__CONFIG__ && window.__CONFIG__.backendUrl) {
    return String(window.__CONFIG__.backendUrl).replace(/\/$/, "");
  }
  // fallback: use location origin so deployments where frontend & backend share origin work
  if (typeof window !== "undefined" && window.location && window.location.origin) {
    return window.location.origin.replace(/\/$/, "");
  }
  // last resort
  return "https://api.your-backend.com";
}
function apiUrl(path) {
  const base = getApiBaseFromEnvOrWindow();
  if (!path) return base;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

/* ---------- Small UI helpers ---------- */
function normalizeAdminUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return window.location.protocol + trimmed;
  if (trimmed.startsWith("/")) return apiUrl(trimmed);
  return apiUrl(trimmed);
}

function ImageSlider({ images = [] }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!images || images.length === 0) return;
    const t = setInterval(() => setActive(p => (p + 1) % images.length), 3500);
    return () => clearInterval(t);
  }, [images]);
  if (!images || images.length === 0) return null;
  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center mt-6 sm:mt-10">
        <img src={images[active]} alt={`Slide ${active + 1}`} className="object-cover w-full h-full" loading="lazy" />
      </div>
    </div>
  );
}

function SectionTitle() {
  return (
    <div className="w-full flex items-center justify-center my-8">
      <div className="flex-grow border-t border-[#21809b]" />
      <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">Exhibitor Registration</span>
      <div className="flex-grow border-t border-[#21809b]" />
    </div>
  );
}

/* ---------- Email helper (best-effort ack) ---------- */
async function sendSimpleAckEmail(exhibitor) {
  try {
    const to = exhibitor.email || (exhibitor._rawForm && (exhibitor._rawForm.email || exhibitor._rawForm.contactEmail)) || "";
    if (!to) return { ok: false, error: "no-recipient" };
    const name = exhibitor.name || exhibitor.companyName || exhibitor.company || "";
    const subject = "RailTrans Expo — We received your exhibitor request";
    const text = `Hello ${name || ""},

Thank you for your exhibitor request. We have received your details and our team will get back to you soon.

Regards,
RailTrans Expo Team`;
    const html = `<p>Hello ${name || ""},</p><p>Thank you for your exhibitor request. We have received your details and our team will get back to you soon.</p><p>Regards,<br/>RailTrans Expo Team</p>`;

    const res = await fetch(apiUrl("/api/mailer"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, text, html }),
    });
    let body = null;
    try { body = await res.json(); } catch {}
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    console.warn("[Exhibitors] sendSimpleAckEmail failed:", e && (e.message || e));
    return { ok: false, error: String(e && e.message ? e.message : e) };
  }
}

/* ---------- Main component ---------- */
export default function Exhibitors() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [savedId, setSavedId] = useState(null);

  const videoRef = useRef(null);
  const [bgVideoError, setBgVideoError] = useState("");
  const [bgVideoReady, setBgVideoReady] = useState(false);

  // Fetch config from backend-configured URL (apiUrl ensures backend host is used)
  async function fetchConfig() {
    setLoading(true);
    try {
      const url = apiUrl("/api/exhibitor-config?cb=" + Date.now());
      const res = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      const cfg = res.ok ? await res.json() : {};
      const normalized = { ...(cfg || {}) };

      // normalize backgroundMedia (support legacy keys)
      if (normalized.backgroundMedia && normalized.backgroundMedia.url) {
        normalized.backgroundMedia = {
          type: normalized.backgroundMedia.type || "image",
          url: normalizeAdminUrl(normalized.backgroundMedia.url),
        };
      } else {
        const candidate = normalized.backgroundVideo || normalized.backgroundImage || normalized.background_image || "";
        if (candidate) {
          const isVideo = typeof candidate === "string" && /\.(mp4|webm|ogg)(\?|$)/i.test(candidate);
          normalized.backgroundMedia = { type: isVideo ? "video" : "image", url: normalizeAdminUrl(candidate) };
        } else {
          normalized.backgroundMedia = { type: "image", url: "" };
        }
      }

      if (normalized.termsUrl) normalized.termsUrl = normalizeAdminUrl(normalized.termsUrl);
      normalized.images = Array.isArray(normalized.images) ? normalized.images.map(normalizeAdminUrl) : [];
      normalized.fields = Array.isArray(normalized.fields) ? normalized.fields : [];
      normalized.eventDetails = typeof normalized.eventDetails === "object" && normalized.eventDetails ? normalized.eventDetails : {};
      setConfig(normalized);
    } catch (e) {
      console.error("[Exhibitors] fetchConfig error:", e);
      setConfig({ fields: [], images: [], backgroundMedia: { type: "image", url: "" }, eventDetails: {} });
      setError("Failed to load configuration.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchConfig();
    const onCfg = () => fetchConfig();
    window.addEventListener("exhibitor-config-updated", onCfg);
    return () => window.removeEventListener("exhibitor-config-updated", onCfg);
  }, []);

  // Video play effect (best-effort)
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !config?.backgroundMedia?.url || config.backgroundMedia.type !== "video") return;
    let mounted = true;
    let attemptId = 0;
    const prevSrc = { src: v.src || "" };

    async function tryPlay() {
      const myId = ++attemptId;
      try {
        const currentSrc = v.currentSrc || v.src || "";
        if (prevSrc.src !== currentSrc) {
          try { v.load(); } catch {}
          prevSrc.src = currentSrc;
        }
        await new Promise((resolve, reject) => {
          if (!mounted) return reject(new Error("unmounted"));
          if (v.readyState >= 3) return resolve();
          const onCan = () => { cleanup(); resolve(); };
          const onErr = () => { cleanup(); reject(new Error("media error")); };
          const timer = setTimeout(() => { cleanup(); resolve(); }, 3000);
          function cleanup() { clearTimeout(timer); v.removeEventListener("canplay", onCan); v.removeEventListener("error", onErr); }
          v.addEventListener("canplay", onCan);
          v.addEventListener("error", onErr);
        });
        if (!mounted || myId !== attemptId) return;
        await v.play();
        if (!mounted || myId !== attemptId) return;
        setBgVideoError("");
        setBgVideoReady(true);
      } catch (err) {
        if (err && err.name === "AbortError") {
          console.warn("[video] play aborted by subsequent load");
        } else if (err && err.name === "NotAllowedError") {
          setBgVideoError("Autoplay prevented; tap to play.");
        } else {
          console.error("[video] play failed:", err);
          setBgVideoError("Video playback failed.");
        }
        setBgVideoReady(false);
      }
    }

    const onCan = () => tryPlay();
    const onErr = (e) => {
      console.error("[video] onError", e);
      setBgVideoError("Video failed to load (check network/CORS).");
      setBgVideoReady(false);
    };
    v.addEventListener("canplay", onCan);
    v.addEventListener("error", onErr);
    tryPlay();

    return () => {
      mounted = false;
      attemptId++;
      try { v.removeEventListener("canplay", onCan); v.removeEventListener("error", onErr); } catch {}
    };
  }, [config?.backgroundMedia?.url]);

  // Save step helper (optional telemetry)
  async function saveStep(stepName, data = {}, meta = {}) {
    try {
      await fetch(apiUrl("/api/exhibitors/step"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: stepName, data, meta }) });
    } catch (e) { console.warn("[Exhibitors] saveStep failed:", e); }
  }

  // send exhibitor to backend; don't drop fields
  async function saveExhibitor(payload) {
    const url = apiUrl("/api/exhibitors");
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const txt = await res.text().catch(()=>null);
    let json = null;
    try { json = txt ? JSON.parse(txt) : null; } catch { json = { raw: txt }; }
    if (!res.ok) {
      const errMsg = (json && (json.message || json.error)) || `Save failed (${res.status})`;
      throw new Error(errMsg);
    }
    return json;
  }

  async function handleSubmit(formData) {
    setError("");
    setForm(formData || {});
    await saveStep("registration_attempt", { form: formData }).catch(()=>{});
    // prepare payload - do not remove admin fields; provide canonical keys and include raw form
    const payload = {
      name: formData.name || formData.fullName || "",
      email: formData.email || "",
      mobile: formData.mobile || formData.phone || "",
      designation: formData.designation || "",
      company: formData.company || formData.companyName || "",
      other_details: formData.other_details || formData.otherDetails || "",
      purpose: formData.purpose || "",
      slots: Array.isArray(formData.slots) ? formData.slots : [],
      ticket_category: formData.ticket_category || formData.category || null,
      txId: formData.txId || null,
      termsAccepted: !!formData.termsAccepted,
      _rawForm: formData
    };
    try {
      const json = await saveExhibitor(payload);
      if (json?.insertedId) setSavedId(json.insertedId);
      await saveStep("registration", { form: formData }, { insertedId: json?.insertedId || null }).catch(()=>{});
      // best-effort ack email in background
      (async () => {
        try {
          const mailRes = await sendSimpleAckEmail(payload);
          if (!mailRes.ok) console.warn("Ack email failed", mailRes);
        } catch (e) { console.warn("Ack email error", e); }
      })();
      setStep(2);
    } catch (err) {
      console.error("[Exhibitors] save error:", err);
      setError(err.message || "Failed to save registration");
    }
  }

  return (
    <div className="min-h-screen w-full relative">
      {/* Background media */}
      {config?.backgroundMedia?.type === "video" && config?.backgroundMedia?.url ? (
        <>
          <video ref={videoRef} src={config.backgroundMedia.url} autoPlay muted loop playsInline preload="auto" crossOrigin="anonymous" style={{ position: "fixed", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: -999 }} />
          
        </>
      ) : (config?.backgroundMedia?.type === "image" && config?.backgroundMedia?.url) ? (
        <div style={{ position: "fixed", inset: 0, zIndex: -999, backgroundImage: `url(${config.backgroundMedia.url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      ) : null}

      <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.55)", zIndex: -900 }} />

      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8 px-4">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 320 }}>
            <div className="sm:w-2/3 w-full flex items-center justify-center">
              {loading ? <div className="text-[#21809b] text-2xl font-bold">Loading...</div> : (config?.images && config.images.length ? <ImageSlider images={config.images} /> : <div className="text-[#21809b]"> </div>)}
            </div>
            <div className="sm:w-1/3 w-full flex items-center justify-center">
              {loading ? <div className="text-[#21809b]">Loading...</div> : <div style={{ width: "100%", maxWidth: 420 }}><h3 className="text-2xl font-bold text-[#21809b] text-center mb-3">{config?.eventDetails?.name}</h3><div className="text-center">{config?.eventDetails?.date} • {config?.eventDetails?.venue}</div></div>}
            </div>
          </div>

          <SectionTitle />

          {!loading && step === 1 && (
            <div className="mx-auto w-full max-w-2xl">
              <DynamicRegistrationForm
                config={config}
                form={form}
                setForm={setForm}
                onSubmit={handleSubmit}
                editable
                terms={{ url: config?.termsUrl, label: config?.termsLabel || "Terms & Conditions", required: !!config?.termsRequired }}
              />
            </div>
          )}

          {step === 2 && (
            <div className="my-6">
              <ThankYouMessage email={form.email || ""} />
            </div>
          )}

          {error && <div className="text-red-600 font-semibold mb-2 text-center">{error}</div>}

          <footer className="mt-16 text-center text-[#21809b] font-semibold py-6 text-lg">© {new Date().getFullYear()} RailTrans Expo</footer>
        </div>
      </div>
    </div>
  );
}