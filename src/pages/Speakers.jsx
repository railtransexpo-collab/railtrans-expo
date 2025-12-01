import React, { useEffect, useRef, useState, useCallback } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";

/*
 Speakers.jsx
 - Loads config from backend
 - Supports backgroundMedia (image or video) coming from backend
 - Shows video on desktop (hidden on mobile)
 - Shows a rotating image slider if config.images is present; slides automatically every few seconds
 - Passes backend-provided terms (termsUrl/termsText/termsLabel/termsRequired) to DynamicRegistrationForm
 - Strips any accept_terms / "I agree" checkbox fields from config.fields before rendering
*/

function getApiBaseFromEnvOrWindow() {
  if (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) return process.env.REACT_APP_API_BASE.replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__API_BASE__) return String(window.__API_BASE__).replace(/\/$/, "");
  if (typeof window !== "undefined" && window.__CONFIG__ && window.__CONFIG__.backendUrl) return String(window.__CONFIG__.backendUrl).replace(/\/$/, "");
  if (typeof window !== "undefined" && window.location && window.location.origin) return window.location.origin.replace(/\/$/, "");
  return "http://localhost:5000";
}
function apiUrl(path) {
  const base = getApiBaseFromEnvOrWindow();
  if (!path) return base;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}
function normalizeAdminUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return window.location.protocol + trimmed;
  if (trimmed.startsWith("/")) return apiUrl(trimmed);
  return apiUrl(trimmed);
}

const API_BASE = getApiBaseFromEnvOrWindow();

/* helpers */
function isEmailLike(v) {
  return typeof v === "string" && /\S+@\S+\.\S+/.test(v);
}
const isFreeCategory = (val) => {
  if (val == null) return false;
  const s = typeof val === "string" ? val.trim().toLowerCase() : val;
  return s === "free" || s === "free ticket" || s === "general" || s === "0" || s === 0;
};
function ticketPriceForCategory(cat) {
  if (!cat) return 0;
  const c = String(cat).toLowerCase();
  if (c === "combo") return 5000;
  if (c === "delegate") return 2500;
  if (c === "vip") return 7500;
  if (/free|general|0/.test(c)) return 0;
  return 2500;
}
async function toBase64(pdf) {
  if (!pdf) return "";
  if (typeof pdf === "string") {
    const m = pdf.match(/^data:application\/pdf;base64,(.*)$/i);
    if (m) return m[1];
    if (/^[A-Za-z0-9+/=]+$/.test(pdf)) return pdf;
    return "";
  }
  if (pdf instanceof ArrayBuffer) pdf = new Blob([pdf], { type: "application/pdf" });
  if (pdf instanceof Blob) {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result || "";
        resolve(String(result).split(",")[1] || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(pdf);
    });
  }
  return "";
}
async function sendMailPayload(payload) {
  const res = await fetch(apiUrl("/api/mailer"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body = null;
  try { body = await res.json(); } catch {}
  return { ok: res.ok, status: res.status, body };
}

/* UI helpers */
function EventDetailsBlock({ event }) {
  if (!event) return <div className="text-[#21809b]">No event details available</div>;
  const logoGradient = "linear-gradient(90deg, #ffba08 0%, #19a6e7 60%, #21809b 100%)";
  const logoBlue = "#21809b";
  const logoDark = "#196e87";
  return (
    <div className="flex flex-col items-center justify-center h-full w-full mt-6">
      <div className="font-extrabold text-3xl sm:text-5xl mb-3 text-center" style={{ background: logoGradient, WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", letterSpacing: "0.03em" }}>
        {event?.name || "Event Name"}
      </div>
      <div className="text-xl sm:text-2xl font-bold mb-1 text-center" style={{ color: logoBlue }}>
        {event?.date || "Event Date"}
      </div>
      <div className="text-base sm:text-xl font-semibold text-center" style={{ color: logoDark }}>
        {event?.venue || "Event Venue"}
      </div>
      {event?.tagline && <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">{event.tagline}</div>}
    </div>
  );
}

function ImageSlider({ images = [], intervalMs = 3500 }) {
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (!images || images.length === 0) return;
    const t = setInterval(() => setActive(p => (p + 1) % images.length), intervalMs);
    return () => clearInterval(t);
  }, [images, intervalMs]);
  if (!images || images.length === 0) return null;
  return (
    <div className="flex flex-col items-center justify-center w-full h-full">
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex items-center justify-center mt-6 sm:mt-10">
        <img src={images[active]} alt={`Slide ${active + 1}`} className="object-cover w-full h-full" loading="lazy" />
      </div>
    </div>
  );
}

/* Main component */
export default function Speakers() {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [speakerId, setSpeakerId] = useState(null);
  const [ticketCategory, setTicketCategory] = useState("");
  const [txId, setTxId] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [pdfBlob, setPdfBlob] = useState(null);
  const [speaker, setSpeaker] = useState(null);

  const videoRef = useRef(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => setIsMobile(!!mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange); };
  }, []);

  const fetchConfig = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(apiUrl("/api/speaker-config?cb=" + Date.now()), { cache: "no-store", headers: { Accept: "application/json" } });
      const cfg = res.ok ? await res.json() : {};
      const normalized = { ...(cfg || {}) };

      // backgroundMedia normalization (support legacy keys)
      if (normalized.backgroundMedia && normalized.backgroundMedia.url) {
        normalized.backgroundMedia = { type: normalized.backgroundMedia.type || "image", url: normalizeAdminUrl(normalized.backgroundMedia.url) };
      } else {
        const candidate = normalized.backgroundVideo || normalized.backgroundImage || normalized.background_image || "";
        if (candidate) {
          const isVideo = typeof candidate === "string" && /\.(mp4|webm|ogg)(\?|$)/i.test(candidate);
          normalized.backgroundMedia = { type: isVideo ? "video" : "image", url: normalizeAdminUrl(candidate) };
        } else {
          normalized.backgroundMedia = { type: "image", url: "" };
        }
      }

      normalized.termsUrl = normalized.termsUrl ? normalizeAdminUrl(normalized.termsUrl) : (normalized.terms || "");
      normalized.termsText = normalized.termsText || "";
      normalized.termsLabel = normalized.termsLabel || "Terms & Conditions";
      normalized.termsRequired = !!normalized.termsRequired;
      normalized.fields = Array.isArray(normalized.fields) ? normalized.fields : [];
      // remove any accept_terms / "I agree" fields from fields array so they won't be rendered as separate checkbox
      normalized.fields = normalized.fields.filter(f => {
        if (!f || typeof f !== "object") return false;
        const name = (f.name || "").toString().toLowerCase().replace(/\s+/g,"");
        const label = (f.label || "").toString().toLowerCase();
        if (["accept_terms","acceptterms","i_agree","agree"].includes(name)) return false;
        if (f.type === "checkbox" && (label.includes("i agree") || label.includes("accept the terms") || label.includes("terms & conditions") || label.includes("terms and conditions"))) return false;
        return true;
      });

      normalized.images = Array.isArray(normalized.images) ? normalized.images.map(normalizeAdminUrl) : [];

      setConfig(normalized);
    } catch (e) {
      console.error("fetchConfig error", e);
      setConfig({ fields: [], images: [], backgroundMedia: { type: "image", url: "" }, eventDetails: {} });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConfig();
    const onCfg = () => fetchConfig();
    window.addEventListener("speaker-config-updated", onCfg);
    return () => window.removeEventListener("speaker-config-updated", onCfg);
  }, [fetchConfig]);

  // auto-play video on desktop (best-effort)
  useEffect(() => {
    if (isMobile) return;
    const v = videoRef.current;
    if (!v || !config?.backgroundMedia?.url || config.backgroundMedia.type !== "video") return;
    let mounted = true;
    let attemptId = 0;
    const prevSrc = { src: v.src || "" };

    async function tryPlay() {
      const myId = ++attemptId;
      try {
        const currentSrc = v.currentSrc || v.src || "";
        if (prevSrc.src !== currentSrc) { try { v.load(); } catch {} prevSrc.src = currentSrc; }
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
      } catch (err) {
        // decorative only
      }
    }

    const onCan = () => tryPlay();
    const onErr = () => {};
    v.addEventListener("canplay", onCan);
    v.addEventListener("error", onErr);
    tryPlay();

    return () => { mounted = false; attemptId++; try { v.removeEventListener("canplay", onCan); v.removeEventListener("error", onErr); } catch {} };
  }, [config?.backgroundMedia?.url, isMobile]);

  /* ---------- Step 1 submit ---------- */
  async function handleFormSubmit(payload) {
    setError("");
    if (!isEmailLike(payload.email)) {
      setError("Please enter a valid email.");
      return;
    }
    setSubmitting(true);
    try {
      const toSend = { ...payload };
      // remove any local accept_terms fields - central terms handling used instead
      delete toSend.accept_terms;
      delete toSend.acceptTerms;
      delete toSend.termsAccepted;

      const res = await fetch(apiUrl("/api/speakers"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toSend),
      });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || !js.success) {
        setError(js.error || "Failed to save registration.");
        return;
      }
      const id = js.insertedId || js.insertId || js.id || null;
      const serverTicket = js.ticket_code || js.ticketCode || null;
      setSpeakerId(id);
      setForm(prev => ({ ...toSend, ticket_code: serverTicket || prev.ticket_code || "" }));
      setStep(2);
    } catch (err) {
      console.error("save speaker error", err);
      setError("Failed to save registration. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleTicketSelect(cat) {
    setTicketCategory(cat);
    if (isFreeCategory(cat)) {
      finalizeRegistrationAndSend(null, cat);
    } else {
      setStep(3);
    }
  }

  async function createOrderAndOpenCheckout(price) {
    setProcessing(true);
    setError("");
    if (!speakerId) {
      setError("Registration id missing. Please refresh and try again.");
      setProcessing(false);
      return;
    }
    try {
      const payload = { amount: price, currency: "INR", description: `Speaker Ticket - ${ticketCategory}`, reference_id: String(speakerId), metadata: { ticketCategory, email: form.email } };
      const res = await fetch(apiUrl("/api/payment/create-order"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const js = await res.json().catch(() => ({}));
      if (!res.ok || !js.success) { setError(js.error || "Failed to create payment order"); setProcessing(false); return; }
      const checkoutUrl = js.checkoutUrl || js.checkout_url || js.raw?.checkout_url || js.raw?.payment_link;
      if (!checkoutUrl) { setError("Payment provider did not return a checkout URL."); setProcessing(false); return; }
      const w = window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      if (!w) { setError("Popup blocked. Allow popups to continue payment."); setProcessing(false); return; }

      let attempts = 0;
      const maxAttempts = 80;
      const poll = setInterval(async () => {
        attempts += 1;
        try {
          const st = await fetch(apiUrl(`/api/payment/status?reference_id=${encodeURIComponent(String(speakerId))}`));
          if (!st.ok) return;
          const js2 = await st.json().catch(() => ({}));
          const status = (js2.status || "").toString().toLowerCase();
          if (["paid","captured","completed","success"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            const providerPaymentId = js2.record?.provider_payment_id || js2.record?.providerPaymentId || null;
            setTxId(providerPaymentId || null);
            await finalizeRegistrationAndSend(providerPaymentId || null, ticketCategory);
          } else if (["failed","cancelled"].includes(status)) {
            clearInterval(poll);
            try { if (w && !w.closed) w.close(); } catch {}
            setError("Payment failed or cancelled. Please retry.");
            setProcessing(false);
          } else if (attempts >= maxAttempts) {
            clearInterval(poll);
            setError("Payment not confirmed yet. If you completed payment, refresh after a moment.");
            setProcessing(false);
          }
        } catch (e) { /* ignore transient */ }
      }, 3000);
    } catch (err) {
      console.error("createOrderAndOpenCheckout error", err);
      setError("Payment initiation failed.");
      setProcessing(false);
    }
  }

  async function onManualProofSubmit(file) {
    try {
      if (file && speakerId) {
        const fd = new FormData();
        fd.append("proof", file);
        fd.append("speakerId", speakerId);
        await fetch(apiUrl(`/api/speakers/${encodeURIComponent(String(speakerId))}/upload-proof`), { method: "POST", body: fd }).catch(() => {});
      }
    } catch (e) {
      console.warn("upload proof failed", e);
    }
    await finalizeRegistrationAndSend(txId || null, ticketCategory);
  }

  async function finalizeRegistrationAndSend(providerTxId = null, chosenCategory = null) {
    setProcessing(true);
    setError("");
    try {
      const name = form.name || `${form.firstName || ""} ${form.lastName || ""}`.trim() || "Speaker";
      const chosen = chosenCategory || ticketCategory || "free";

      let ticket_code = form.ticket_code || speaker?.ticket_code || null;

      if (!ticket_code && speakerId) {
        try {
          const r = await fetch(apiUrl(`/api/speakers/${encodeURIComponent(String(speakerId))}`));
          if (r.ok) {
            const row = await r.json().catch(() => null);
            ticket_code = (row && (row.ticket_code || row.code)) || ticket_code;
            if (ticket_code) setForm(prev => ({ ...prev, ticket_code }));
          }
        } catch (e) {}
      }

      if (!ticket_code) {
        const generated = String(Math.floor(100000 + Math.random() * 900000));
        if (speakerId) {
          try {
            await fetch(apiUrl(`/api/speakers/${encodeURIComponent(String(speakerId))}/confirm`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_code: generated, force: true }) }).catch(() => {});
            ticket_code = generated;
            setForm(prev => ({ ...prev, ticket_code: generated }));
          } catch (e) {
            ticket_code = generated;
            setForm(prev => ({ ...prev, ticket_code: generated }));
          }
        }
      }

      const fullSpeaker = { ...form, name, ticket_category: chosen, ticket_code: form.ticket_code || ticket_code, txId: providerTxId || txId || null, slots: Array.isArray(form.slots) ? form.slots : [], eventDetails: config?.eventDetails || {} };
      setSpeaker(fullSpeaker);

      // persist ticket
      try { await fetch(apiUrl("/api/tickets/create"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_code: fullSpeaker.ticket_code, entity_type: "speaker", entity_id: speakerId || null, name, email: fullSpeaker.email || null, company: fullSpeaker.company || null, category: chosen, meta: { createdFrom: "web" } }) }).catch(() => {}); } catch (e) {}

      // update speaker row
      if (speakerId) {
        try { await fetch(apiUrl(`/api/speakers/${encodeURIComponent(String(speakerId))}/confirm`), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_category: chosen, txId: providerTxId || txId || null }) }).catch(() => {}); } catch (e) {}
      }

      // generate pdf
      let pdf = null;
      try { if (typeof generateVisitorBadgePDF === "function") { pdf = await generateVisitorBadgePDF(fullSpeaker, config?.badgeTemplateUrl || "", { includeQRCode: true, event: config?.eventDetails || {} }); setPdfBlob(pdf); } } catch (e) { console.warn("PDF generation failed:", e); pdf = null; }

      // send email
      try {
        const mail = { to: fullSpeaker.email, subject: `RailTrans Expo - Your Ticket (${chosen})`, text: `Hello ${name},\n\nYour ticket code: ${fullSpeaker.ticket_code}\n\nThank you.`, html: `<p>Hi ${name},</p><p>Your ticket code: <strong>${fullSpeaker.ticket_code}</strong></p>` };
        if (pdf) { const pdfBase64 = await toBase64(pdf); if (pdfBase64) mail.attachments = [{ filename: "RailTransExpo-E-Badge.pdf", content: pdfBase64, encoding: "base64", contentType: "application/pdf" }]; }
        const mailRes = await sendMailPayload(mail);
        if (!mailRes.ok) setError(prev => prev ? prev + " Email not sent." : "Email not sent. We'll retry.");
      } catch (e) { console.warn("Failed to send email", e); setError(prev => prev ? prev + " Email not sent." : "Email not sent. We'll retry."); }

      // whatsapp
      try { if (fullSpeaker.mobile) await fetch(apiUrl("/api/notify/whatsapp"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ to: fullSpeaker.mobile, message: `Your RailTrans Expo ticket code: ${fullSpeaker.ticket_code}` }) }); } catch (e) { console.warn("whatsapp failed", e); }

      // admin notify
      try { const adminEmail = process.env.REACT_APP_ADMIN_EMAIL || "admin@railtransexpo.com"; await sendMailPayload({ to: adminEmail, subject: `New Speaker Registered: ${name}`, text: `Name: ${name}\nEmail: ${fullSpeaker.email}\nCategory: ${chosen}\nTicket: ${fullSpeaker.ticket_code}\nTx: ${providerTxId || txId || "N/A"}` }).catch(() => {}); } catch (e) {}

      setStep(4);
    } catch (err) {
      console.error("finalize error", err);
      setError("Failed to finalize registration.");
    } finally {
      setProcessing(false);
    }
  }

  /* ---------- small UI helpers ---------- */
  function HeroBlock() {
    const event = config?.eventDetails || {};
    return (
      <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-[#19a6e7] h-[220px] sm:h-[320px] w-[340px] sm:w-[500px] max-w-full bg-white/75 flex flex-col items-center justify-center mt-6 sm:mt-10 p-4">
        <img src={config?.images?.[0] || "/images/speaker_placeholder.jpg"} alt="hero" className="object-cover w-full h-full" style={{ maxHeight: 220 }} />
        <div className="mt-3 text-center">
          <div className="text-lg font-bold text-[#196e87]">{event.name || ""}</div>
          <div className="text-sm text-[#21809b]">{event.date || ""}</div>
        </div>
      </div>
    );
  }

  function TicketSelectionCard() {
    return (
      <div className="bg-white rounded-2xl shadow p-6 mb-6">
        <h3 className="text-lg font-semibold text-[#196e87] mb-3">Choose Ticket</h3>
        <TicketCategorySelector value={ticketCategory} onChange={handleTicketSelect} />
        {!isEmailLike(form.email) && <div className="text-red-600 mt-3">No email available on your registration — go back and add email.</div>}
      </div>
    );
  }

  /* ---------- render ---------- */
  return (
    <div className="min-h-screen w-full relative">
      {/* Background video on desktop only */}
      {!isMobile && config?.backgroundMedia?.type === "video" && config?.backgroundMedia?.url && (
        <video ref={videoRef} src={config.backgroundMedia.url} autoPlay muted loop playsInline preload="auto" crossOrigin="anonymous" style={{ position: "fixed", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: -999 }} />
      )}
      {/* image background fallback */}
      {(!config?.backgroundColor) && config?.backgroundMedia?.type === "image" && config?.backgroundMedia?.url && (
        <div style={{ position: "fixed", inset: 0, zIndex: -999, backgroundImage: `url(${config.backgroundMedia.url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      )}
      {/* translucent overlay */}
      <div style={{ position: "fixed", inset: 0, background: "rgba(255,255,255,0.55)", zIndex: -900 }} />

      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8 px-4">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 370 }}>
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? <span className="text-[#21809b] text-2xl font-bold">Loading images...</span> : (config?.images && config.images.length ? <ImageSlider images={config.images} intervalMs={4000} /> : <HeroBlock />)}
            </div>

            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? <span className="text-[#21809b] text-xl font-semibold">Loading event details...</span> : <div className="w-full px-4"><EventDetailsBlock event={config?.eventDetails || null} /></div>}
            </div>
          </div>

          <div className="mb-6">
            <div className="flex items-center">
              <div className="flex-grow border-t border-[#21809b]" />
              <span className="mx-5 px-8 py-3 text-2xl font-extrabold text-[#21809b] bg-white rounded-2xl">Register as Speaker</span>
              <div className="flex-grow border-t border-[#21809b]" />
            </div>
          </div>

          {/* Step 1 */}
          {step === 1 && !loading && Array.isArray(config?.fields) && (
            <div className="max-w-3xl mx-auto">
              <DynamicRegistrationForm
                config={{ ...config, fields: (config.fields || []) }}
                form={form}
                setForm={setForm}
                onSubmit={handleFormSubmit}
                editable={true}
                submitting={submitting}
                terms={(config && (config.termsUrl || config.termsText)) ? { url: config.termsUrl, text: config.termsText, label: config.termsLabel || "Terms & Conditions", required: !!config.termsRequired } : null}
              />
            </div>
          )}

          {/* Step 2 */}
          {step === 2 && <div className="max-w-3xl mx-auto">{TicketSelectionCard()}</div>}

          {/* Step 3 */}
          {step === 3 && (
            <div className="max-w-3xl mx-auto">
              <ManualPaymentStep
                ticketType={ticketCategory}
                ticketPrice={ticketPriceForCategory(ticketCategory)}
                onProofUpload={(file) => onManualProofSubmit(file)}
                onTxIdChange={(val) => setTxId(val)}
                txId={txId}
                proofFile={proofFile}
                setProofFile={setProofFile}
              />
              <div className="flex justify-center gap-3 mt-4">
                <button className="px-6 py-2 bg-[#196e87] text-white rounded" onClick={() => createOrderAndOpenCheckout(ticketPriceForCategory(ticketCategory))} disabled={processing}>
                  {processing ? "Processing..." : "Pay & Complete"}
                </button>
              </div>
              {processing && <div className="mt-4 text-center text-gray-600">Finalizing — please wait...</div>}
              {error && <div className="mt-3 text-red-600 font-medium">{error}</div>}
            </div>
          )}

          {/* Step 4 */}
          {step === 4 && (
            <div className="max-w-3xl mx-auto">
              <ThankYouMessage email={speaker?.email || form.email} />
            </div>
          )}

          <footer className="mt-12 text-center text-[#21809b] font-semibold py-6">© {new Date().getFullYear()} {config?.eventDetails?.name || "RailTrans Expo"} | All rights reserved.</footer>
        </div>
      </div>
    </div>
  );
}