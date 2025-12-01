import React, { useEffect, useRef, useState } from "react";
import Topbar from "../components/Topbar";
import DynamicRegistrationForm from "./DynamicRegistrationForm";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ManualPaymentStep from "../components/ManualPayemntStep";
import ThankYouMessage from "../components/ThankYouMessage";
import { generateVisitorBadgePDF } from "../utils/pdfGenerator";

/*
  Visitors.jsx - fixes applied
  - Correct API_BASE resolution (process.env -> window.__API_BASE__ -> fallback)
  - fetchConfig uses cache: "no-store" and logs request/response
  - Mobile detection: on mobile show only form (no images/background video)
  - Robust background video play logic (serializes attempts, avoids overlapping load/play)
  - Fixed saveVisitor and other broken fetch bodies and template string bugs
  - Removed accidental hardcoded ngrok-first logic and ngrok headers
*/

const API_BASE = (process.env.REACT_APP_API_BASE || window.__API_BASE__ || "http://localhost:5000").replace(/\/$/, "");

/* ---------- Helpers ---------- */
function isEmailLike(v) { return typeof v === "string" && /\S+@\S+\.\S+/.test(v); }

function findEmailDeep(obj, seen = new Set()) {
  if (!obj || typeof obj !== "object") return "";
  if (seen.has(obj)) return "";
  seen.add(obj);
  for (const [, v] of Object.entries(obj)) {
    if (typeof v === "string" && isEmailLike(v)) return v.trim();
    if (v && typeof v === "object") {
      const nested = findEmailDeep(v, seen);
      if (nested) return nested;
    }
  }
  return "";
}

function extractEmailFromForm(form) {
  if (!form || typeof form !== "object") return "";
  const keys = ["email","mail","emailId","email_id","Email","contactEmail","contact_email","visitorEmail","user_email","primaryEmail","primary_email"];
  for (const k of keys) {
    const v = form[k];
    if (isEmailLike(v)) return v.trim();
  }
  const containers = ["contact","personal","user","profile"];
  for (const c of containers) {
    const v = form[c];
    if (v && typeof v === "object") {
      const f = extractEmailFromForm(v);
      if (f) return f;
    }
  }
  return findEmailDeep(form);
}

function getEmailFromAnyStorage() {
  const candidates = new Set();
  try {
    const storages = [window.localStorage, window.sessionStorage];
    const knownKeys = ["verifiedEmail","otpEmail","otp:email","otp_value","visitorEmail","email","user_email"];
    for (const store of storages) {
      for (const k of knownKeys) {
        const v = store.getItem(k);
        if (isEmailLike(v)) candidates.add(v);
      }
      for (let i = 0; i < store.length; i++) {
        const key = store.key(i);
        try {
          const raw = store.getItem(key);
          if (isEmailLike(raw)) candidates.add(raw);
          try { const parsed = JSON.parse(raw); const found = findEmailDeep(parsed); if (found) candidates.add(found); } catch {}
        } catch {}
      }
    }
  } catch {}
  if (typeof window !== "undefined" && window.__lastOtpEmail && isEmailLike(window.__lastOtpEmail)) candidates.add(window.__lastOtpEmail);
  for (const c of candidates) if (isEmailLike(c)) return c.trim();
  return "";
}

function getEmailFromQuery() {
  if (typeof window === "undefined") return "";
  try { const u = new URL(window.location.href); const e = u.searchParams.get("email"); if (isEmailLike(e)) return e.trim(); } catch {}
  return "";
}

function getBestEmail(form) { return extractEmailFromForm(form) || getEmailFromAnyStorage() || getEmailFromQuery() || ""; }

function normalizeAdminUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("//")) return window.location.protocol + trimmed;
  if (trimmed.startsWith("/")) return API_BASE + trimmed;
  return API_BASE + "/" + trimmed;
}

async function toBase64(pdf) {
  try {
    if (!pdf) return "";
    if (typeof pdf === "string") {
      const m = pdf.match(/^data:application\/pdf;base64,(.*)$/i);
      if (m) return m[1];
      if (/^[A-Za-z0-9+/=]+$/.test(pdf)) return pdf;
      return "";
    }
    if (pdf instanceof ArrayBuffer) pdf = new Blob([pdf], { type: "application/pdf" });
    else if (pdf && typeof pdf === "object" && pdf.buffer instanceof ArrayBuffer) pdf = new Blob([pdf], { type: "application/pdf" });
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
  } catch { return ""; }
}

async function sendConfirmationEmailWithPDF(visitor, pdfBlob) {
  const to = visitor?.email;
  if (!to) throw new Error("No email");
  const base = { to, subject: `RailTrans Expo - Ticket ${visitor?.ticket_code || ""}`, text: `Ticket code: ${visitor?.ticket_code || ""}` , html: `<p>Ticket: ${visitor?.ticket_code || ""}</p>` };
  const body = { ...base };
  if (pdfBlob) {
    const b64 = await toBase64(pdfBlob);
    if (b64) body.attachments = [{ filename: "badge.pdf", content: b64, encoding: "base64", contentType: "application/pdf" }];
  }
  const res = await fetch(`${API_BASE}/api/mailer`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`Mailer failed: ${res.status} ${t}`);
  }
}

/* ---------- UI components ---------- */
function SectionTitle() {
  return (
    <div className="w-full flex items-center justify-center my-6 sm:my-8">
      <div className="flex-grow border-t border-[#21809b]" />
      <span className="mx-3 sm:mx-5 px-4 sm:px-8 py-2 sm:py-3 text-lg sm:text-2xl font-extrabold text-[#21809b] bg-white shadow rounded-2xl">Visitor Registration</span>
      <div className="flex-grow border-t border-[#21809b]" />
    </div>
  );
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
        <img src={images[active]} alt={`Visitor ${active + 1}`} className="object-cover w-full h-full" loading="lazy" />
      </div>
    </div>
  );
}
function EventDetailsBlock({ event }) {
  if (!event) return null;
  return (
    <div className="flex flex-col items-center justify-center h-full w-full mt-6">
      <div className="font-extrabold text-3xl sm:text-5xl mb-3 text-center" style={{ background: "linear-gradient(90deg,#ffba08 0%,#19a6e7 60%,#21809b 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>{event?.name || "Event Name"}</div>
      <div className="text-xl sm:text-2xl font-bold mb-1 text-center text-[#21809b]">{event?.date || "Event Date"}</div>
      <div className="text-base sm:text-xl font-semibold text-center text-[#196e87]">{event?.venue || "Event Venue"}</div>
      {event?.tagline && <div className="text-base sm:text-xl font-semibold text-center text-[#21809b] mt-2">{event.tagline}</div>}
    </div>
  );
}

/* ---------- Main component ---------- */
export default function Visitors() {
  const [step, setStep] = useState(1);
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({});
  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketMeta, setTicketMeta] = useState({ price: 0, gstAmount: 0, total: 0, label: "" });
  const [txId, setTxId] = useState("");
  const [proofFile, setProofFile] = useState(null);
  const [visitor, setVisitor] = useState(null);
  const [savedVisitorId, setSavedVisitorId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [badgeTemplateUrl, setBadgeTemplateUrl] = useState("");
  const [error, setError] = useState("");
  const finalizeCalledRef = useRef(false);

  const videoRef = useRef(null);
  const [bgVideoError, setBgVideoError] = useState("");
  const [bgVideoReady, setBgVideoReady] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  // mobile detection (max-width 640)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const onChange = () => setIsMobile(!!mq.matches);
    onChange();
    if (mq.addEventListener) mq.addEventListener("change", onChange);
    else mq.addListener(onChange);
    return () => { if (mq.removeEventListener) mq.removeEventListener("change", onChange); else mq.removeListener(onChange); };
  }, []);

  /* ---------- fetch config ---------- */
  async function fetchConfig() {
    setLoading(true);
    try {
      const url = `${API_BASE}/api/visitor-config?cb=${Date.now()}`;
      console.info("[Visitors] fetching config", url);
      const r = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
      const cfg = r.ok ? await r.json() : {};
      console.debug("[Visitors] config received", cfg);
      const normalized = { ...(cfg || {}) };
      if (normalized.backgroundMedia && normalized.backgroundMedia.url) {
        normalized.backgroundMedia = { type: normalized.backgroundMedia.type || "image", url: normalizeAdminUrl(normalized.backgroundMedia.url) };
      } else {
        normalized.backgroundMedia = normalized.backgroundMedia || { type: "image", url: "" };
      }
      if (normalized.termsUrl) normalized.termsUrl = normalizeAdminUrl(normalized.termsUrl);
      normalized.fields = Array.isArray(normalized.fields) ? normalized.fields : [];
      // If mobile-only mode desired, we can strip images/background here (optional)
      setConfig(normalized);
      setBadgeTemplateUrl(cfg?.badgeTemplateUrl || "");
    } catch (e) {
      console.error("[Visitors] Failed to load visitor config:", e);
      setConfig({ fields: [] });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchConfig();
    const onCfg = () => { console.info("visitor-config-updated event, refetch"); fetchConfig(); };
    window.addEventListener("visitor-config-updated", onCfg);
    return () => window.removeEventListener("visitor-config-updated", onCfg);
  }, []);

  /* ---------- video play effect (skip on mobile) ---------- */
  useEffect(() => {
    if (isMobile) return;
    const v = videoRef.current;
    if (!v) return;
    if (!config?.backgroundMedia?.url) return;

    let mounted = true;
    let attemptId = 0;
    const prevSrcRef = { src: v.src || "" };

    async function tryPlay() {
      const myId = ++attemptId;
      try {
        const currentSrc = v.currentSrc || v.src || "";
        if (prevSrcRef.src !== currentSrc) {
          try { v.load(); } catch {}
          prevSrcRef.src = currentSrc;
        }

        await new Promise((resolve, reject) => {
          if (!mounted) return reject(new Error("unmounted"));
          if (v.readyState >= 3) return resolve();
          const onCan = () => { cleanup(); resolve(); };
          const onErr = () => { cleanup(); reject(new Error("media error")); };
          const timer = setTimeout(() => { cleanup(); resolve(); }, 3000);
          function cleanup() {
            clearTimeout(timer);
            v.removeEventListener("canplay", onCan);
            v.removeEventListener("error", onErr);
          }
          v.addEventListener("canplay", onCan);
          v.addEventListener("error", onErr);
        });

        if (!mounted || myId !== attemptId) return;
        await v.play();
        if (!mounted || myId !== attemptId) return;
        setBgVideoError("");
        setBgVideoReady(true);
        console.info("[video] play succeeded");
      } catch (err) {
        if (err && err.name === "AbortError") {
          console.warn("[video] play() aborted due to new load/src change");
        } else if (err && err.name === "NotAllowedError") {
          console.warn("[video] autoplay blocked");
          setBgVideoError("Autoplay prevented by browser; tap to play.");
        } else {
          console.error("[video] play error:", err);
          setBgVideoError("Video playback failed.");
        }
        setBgVideoReady(false);
      }
    }

    const onCanPlay = () => tryPlay();
    const onError = (e) => {
      console.error("[video] onError", e);
      setBgVideoError("Background video failed to load (check network/CORS).");
      setBgVideoReady(false);
    };

    v.addEventListener("canplay", onCanPlay);
    v.addEventListener("error", onError);

    tryPlay();

    return () => {
      mounted = false;
      attemptId++;
      try { v.removeEventListener("canplay", onCanPlay); v.removeEventListener("error", onError); } catch {}
    };
  }, [config?.backgroundMedia?.url, isMobile]);

  /* ---------- backend helpers ---------- */
  async function saveStep(stepName, data = {}, meta = {}) {
    try {
      await fetch(`${API_BASE}/api/visitors/step`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: stepName, data, meta }) });
    } catch (e) { console.warn("[Visitors] saveStep failed:", stepName, e); }
  }

  async function saveVisitor(nextForm) {
    const payload = {
      name: nextForm.name || `${nextForm.firstName || ""} ${nextForm.lastName || ""}`.trim() || "",
      email: nextForm.email || "",
      mobile: nextForm.mobile || nextForm.phone || nextForm.contact || "",
      designation: nextForm.designation || "",
      company_type: nextForm.company_type || nextForm.companyType || null,
      company: nextForm.company || nextForm.organization || null,
      other_details: nextForm.other_details || nextForm.otherDetails || "",
      purpose: nextForm.purpose || "",
      ticket_category: ticketCategory || null,
      ticket_label: ticketMeta.label || null,
      ticket_price: ticketMeta.price || 0,
      ticket_gst: ticketMeta.gstAmount || 0,
      ticket_total: ticketMeta.total || 0,
      category: ticketCategory || null,
      slots: Array.isArray(nextForm.slots) ? nextForm.slots : [],
      txId: txId || null,
      termsAccepted: !!nextForm.termsAccepted
    };

    const res = await fetch(`${API_BASE}/api/visitors`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    let json = null;
    try { json = await res.json(); } catch {}
    if (!res.ok) { throw new Error((json && (json.message || json.error)) || `Save failed (${res.status})`); }
    return json;
  }

  /* ---------- Step handlers ---------- */
  async function handleFormSubmit(formData) {
    setError("");
    const ensuredEmail = getBestEmail(formData);
    const nextForm = ensuredEmail ? { ...formData, email: ensuredEmail } : { ...formData };
    setForm(nextForm);
    await saveStep("registration_attempt", { form: nextForm });
    try {
      const json = await saveVisitor(nextForm);
      if (json?.insertedId) setSavedVisitorId(json.insertedId);
      if (json?.ticket_code) setForm(prev => ({ ...prev, ticket_code: json.ticket_code }));
      setVisitor(prev => ({ ...(prev || {}), id: json?.insertedId || prev?.id, ticket_code: json?.ticket_code || prev?.ticket_code, name: nextForm.name, email: nextForm.email }));
      await saveStep("registration", { form: nextForm }, { insertedId: json?.insertedId || null, ticket_code: json?.ticket_code || null });
      setStep(2);
    } catch (err) {
      console.error("[Visitors] handleFormSubmit error:", err);
      setError(err.message || "Failed to save registration. Please try again.");
    }
  }

  async function handleTicketSelect(value, meta = {}) {
    setError("");
    setTicketCategory(value);
    setTicketMeta(meta || { price: 0, gstAmount: 0, total: 0, label: "" });
    await saveStep("ticket_selected", { ticketCategory: value, form }, { ticketMeta: meta || {} });
    setStep(3);
  }

  async function completeRegistrationAndEmail() {
    if (finalizeCalledRef.current) return;
    finalizeCalledRef.current = true;
    try {
      setProcessing(true);
      if (config?.termsRequired && !form?.termsAccepted) {
        setError(config?.termsRequiredMessage || "You must accept the terms and conditions to complete registration.");
        setProcessing(false);
        finalizeCalledRef.current = false;
        return;
      }
      const bestEmail = getBestEmail(form);
      if (!bestEmail) { setError("Email is required"); setProcessing(false); finalizeCalledRef.current = false; return; }
      if (!extractEmailFromForm(form)) setForm(prev => ({ ...prev, email: bestEmail }));

      let ticket_code = form.ticket_code || (visitor && visitor.ticket_code) || null;
      if (!ticket_code && savedVisitorId) {
        try {
          const r = await fetch(`${API_BASE}/api/visitors/${encodeURIComponent(String(savedVisitorId))}`);
          if (r.ok) {
            const row = await r.json();
            ticket_code = row?.ticket_code || row?.ticketCode || row?.code || null;
            if (ticket_code) setForm(prev => ({ ...prev, ticket_code }));
          }
        } catch (e) { console.warn("fetch saved visitor failed", e); }
      }
      if (!ticket_code) {
        const gen = String(Math.floor(100000 + Math.random() * 900000));
        ticket_code = gen;
        if (savedVisitorId) {
          try {
            await fetch(`${API_BASE}/api/visitors/${encodeURIComponent(String(savedVisitorId))}/confirm`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticket_code: gen, force: true }) });
          } catch (e) { /* ignore */ }
        } else {
          try { await saveVisitor({ ...form, ticket_code: gen }); } catch {}
        }
        setForm(prev => ({ ...prev, ticket_code }));
      }

      const fullVisitor = { ...form, ticket_code, ticket_category: ticketCategory, ticket_price: ticketMeta.price, ticket_gst: ticketMeta.gstAmount, ticket_total: ticketMeta.total };
      setVisitor(fullVisitor);
      await saveStep("finalizing_start", { fullVisitor });

      let pdfBlob = null;
      try {
        pdfBlob = await generateVisitorBadgePDF(fullVisitor, badgeTemplateUrl || "", { includeQRCode: true, qrPayload: { n: fullVisitor.name, e: fullVisitor.email, c: fullVisitor.ticket_code }, event: config?.eventDetails || {} });
      } catch (e) { console.warn("PDF gen failed", e); pdfBlob = null; }

      if (!emailSent) {
        setEmailSent(true);
        try {
          await sendConfirmationEmailWithPDF(fullVisitor, pdfBlob);
          await saveStep("emailed", { fullVisitor }, { savedVisitorId });
        } catch (mailErr) {
          console.error("Email failed:", mailErr);
          await saveStep("email_failed", { fullVisitor }, { error: String(mailErr) });
          setError("Saved but email failed");
        }
      }

      setStep(4);
    } catch (err) {
      console.error("completeRegistrationAndEmail error:", err);
      setError("Finalization failed");
    } finally {
      setProcessing(false);
      finalizeCalledRef.current = false;
    }
  }

  useEffect(() => {
    if (step === 3 && Number(ticketMeta.total) === 0 && !processing) completeRegistrationAndEmail();
  }, [step, ticketMeta]);

  /* ---------- Render ---------- */
  // Mobile: show only the form (no images/video)
  if (isMobile) {
    return (
      <div className="min-h-screen w-full bg-white flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <Topbar />
          {!loading && Array.isArray(config?.fields) ? (
            <DynamicRegistrationForm config={config} form={form} setForm={setForm} onSubmit={handleFormSubmit} editable terms={{ url: config?.termsUrl, label: config?.termsLabel, required: !!config?.termsRequired }} />
          ) : (
            <div className="text-center py-8">Loading...</div>
          )}
        </div>
      </div>
    );
  }

  // Desktop / non-mobile layout
  return (
    <div className="min-h-screen w-full relative" style={{ backgroundSize: "cover", backgroundPosition: "center" }}>
      {config?.backgroundMedia?.type === "video" && config?.backgroundMedia?.url && (
        <>
          <video ref={videoRef} key={config.backgroundMedia.url} src={config.backgroundMedia.url} autoPlay muted loop playsInline preload="auto" crossOrigin="anonymous" className="fixed inset-0 w-full h-full object-cover -z-10" onError={(e) => { console.error("bg video error", e); setBgVideoError("Background video failed"); }} />
         
        </>
      )}

      {(!config?.backgroundMedia?.url || config?.backgroundMedia?.type === "image") && config?.backgroundMedia?.url && (
        <div className="fixed inset-0 -z-10" style={{ backgroundImage: `url(${config.backgroundMedia.url})`, backgroundSize: "cover", backgroundPosition: "center" }} />
      )}

      <div className="absolute inset-0 bg-white/50 pointer-events-none" style={{ zIndex: -900 }} />

      <div className="relative z-10">
        <Topbar />
        <div className="max-w-7xl mx-auto pt-8">
          <div className="flex flex-col sm:flex-row items-stretch mb-10" style={{ minHeight: 370 }}>
            <div className="sm:w-[60%] w-full flex items-center justify-center">
              {loading ? <div className="text-[#21809b] text-2xl font-bold">Loading...</div> : <ImageSlider images={config?.images || []} />}
            </div>
            <div className="sm:w-[40%] w-full flex items-center justify-center">
              {loading ? <div className="text-[#21809b] text-xl font-semibold">Loading event details...</div> : <EventDetailsBlock event={config?.eventDetails || null} />}
            </div>
          </div>

          <SectionTitle />

          {!loading && step === 1 && Array.isArray(config?.fields) && (
            <div className="mx-auto w-full max-w-2xl">
              <DynamicRegistrationForm config={config} form={form} setForm={setForm} onSubmit={handleFormSubmit} editable terms={{ url: config?.termsUrl, label: config?.termsLabel, required: !!config?.termsRequired }} />
            </div>
          )}

          {!loading && step === 2 && <TicketCategorySelector role="visitors" value={ticketCategory} onChange={handleTicketSelect} />}

          {step === 3 && !(/free|general|0/i.test(String(ticketCategory || ""))) && !processing && (
            <ManualPaymentStep ticketType={ticketCategory} ticketPrice={ticketMeta.total || 0} onProofUpload={() => completeRegistrationAndEmail()} onTxIdChange={(val) => setTxId(val)} txId={txId} proofFile={proofFile} setProofFile={setProofFile} />
          )}

          {step === 3 && processing && (
            <div className="py-20 text-center text-white">
              <div className="text-lg sm:text-xl font-semibold">Finalizing your registration...</div>
            </div>
          )}

          {step === 4 && <ThankYouMessage email={visitor?.email} messageOverride="Thank you for registering — check your email for the ticket." />}

          {error && <div className="text-red-400 text-center mt-4">{error}</div>}

          <div className="mt-10 sm:mt-12 pb-8">
            <footer className="text-center text-white font-semibold py-4 text-sm sm:text-lg">© {new Date().getFullYear()} RailTrans Expo</footer>
          </div>
        </div>
      </div>
    </div>
  );
}