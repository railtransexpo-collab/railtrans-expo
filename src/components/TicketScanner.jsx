import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";

// ====== LOGGING UTILITY ======
const LOG_PREFIX = "[TicketScanner]";
function log(...args) {
  console.log(LOG_PREFIX, ...args);
}
log("✅ Module loaded successfully");

// ====== API HELPERS ======
function apiUrl(path) {
  if (!path) return "";
  const s = String(path).trim();
  if (/^https?:\/\//i.test(s)) return s;
  const API_BASE =
    (typeof window !== "undefined" && (window.__API_BASE__ || window.__BACKEND_ORIGIN__ || window.location?.origin)) || "";
  const base = String(API_BASE).replace(/\/$/, "");
  return `${base}${s.startsWith("/") ? s : `/${s}`}`;
}

// ====== TICKET ID EXTRACTION ======
function extractTicketId(input) {
  if (!input) return null;
  const s = String(input).trim();
  
  // Try JSON
  try {
    const parsed = JSON.parse(s);
    if (parsed?.ticket_code) return String(parsed.ticket_code);
    if (parsed?.ticketCode) return String(parsed.ticketCode);
    if (parsed?.code) return String(parsed.code);
    if (parsed?.id) return String(parsed.id);
  } catch (_) {}
  
  // Try numeric
  const numMatch = s.match(/\b\d{6,8}\b/);
  if (numMatch) return numMatch[0];
  
  // Try alphanumeric
  const alphaMatch = s.match(/[A-Za-z0-9]{6,12}/);
  return alphaMatch ? alphaMatch[0] : null;
}

function extractNameAndOrganization(ticket) {
  if (!ticket || typeof ticket !== "object") return { name: "Guest", organization: "Visitor" };
  return {
    name: ticket.name || ticket.full_name || ticket.fullName || "Guest",
    organization: ticket.company || ticket.organization || ticket.org || "Visitor",
  };
}

// ====== BADGE MODAL (Portal) ======
function BadgeModal({ ticketId, validation, printUrl, onClose, onScanAgain }) {
  log("🟢 BadgeModal mounted, ticketId:", ticketId);

  const [pdfUrl, setPdfUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const mountedRef = useRef(true);
  const pdfUrlRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!ticketId) {
      setLoading(false);
      setError("No ticket ID provided");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    log("🟢 Fetching PDF for ticket:", ticketId);

    fetch(printUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: String(ticketId) }),
      credentials: "include",
    })
      .then(async (res) => {
        log("🟢 PDF response status:", res.status);
        if (!res.ok) {
          const js = await res.json().catch(() => ({}));
          throw new Error(js?.error || `Server error ${res.status}`);
        }
        const blob = await res.blob();
        log("🟢 PDF blob size:", blob.size, "bytes");
        if (cancelled || !mountedRef.current) return;
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
        setLoading(false);
      })
      .catch((err) => {
        log("🔴 PDF fetch error:", err.message);
        if (cancelled || !mountedRef.current) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [ticketId, printUrl]);

  function handlePrint() {
    log("🟢 Print button clicked");
    if (!pdfUrl) return;
    
    // Open in new tab and trigger print
    const w = window.open(pdfUrl, "_blank");
    if (w) {
      setTimeout(() => {
        try { w.print(); } catch (e) {
          log("🔴 Print failed:", e);
          alert("Could not print automatically. The PDF opened in a new tab - you can print from there (Ctrl+P).");
        }
      }, 1000);
    } else {
      // Fallback - open in current window
      window.location.href = pdfUrl;
    }
  }

  function handleRetry() {
    log("🟢 Retry button clicked");
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    setPdfUrl(null);
    setError(null);
    setLoading(true);

    fetch(printUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticketId: String(ticketId) }),
      credentials: "include",
    })
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed");
        const blob = await res.blob();
        if (!mountedRef.current) return;
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
        setLoading(false);
      })
      .catch((err) => {
        if (mountedRef.current) { setError(err.message); setLoading(false); }
      });
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 99999, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ background: "white", borderRadius: 12, width: "100%", maxWidth: 800, maxHeight: "90vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.3)" }}>
        {/* Header */}
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 16 }}>Badge Preview — {ticketId}</strong>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 24, cursor: "pointer", padding: 0 }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 400, overflow: "auto" }}>
          {loading && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 400, color: "#6b7280" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 40 }}>⏳</div>
                <div style={{ marginTop: 8, fontSize: 16 }}>Loading badge preview...</div>
              </div>
            </div>
          )}
          {error && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 400, color: "#dc2626", padding: 20 }}>
              <div style={{ fontSize: 40 }}>⚠️</div>
              <div style={{ marginTop: 8, fontSize: 16, fontWeight: 600 }}>Error Loading Badge</div>
              <div style={{ marginTop: 4, fontSize: 14 }}>{error}</div>
              <button onClick={handleRetry} style={{ marginTop: 16, padding: "10px 24px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
                🔄 Retry
              </button>
            </div>
          )}
          {!loading && !error && pdfUrl && (
            <iframe src={pdfUrl} style={{ width: "100%", height: 400, border: "none" }} title="Badge Preview" />
          )}
        </div>

        {/* Footer */}
        <div style={{ padding: "12px 20px", borderTop: "1px solid #e5e7eb", background: "#f9fafb", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "#6b7280" }}>
            {validation?.ticket?.name && `Attendee: ${validation.ticket.name}`}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onScanAgain} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>Scan Again</button>
            <button onClick={onClose} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>Close</button>
            <button onClick={handlePrint} disabled={!pdfUrl} style={{ padding: "8px 20px", background: pdfUrl ? "#196e87" : "#d1d5db", color: "white", border: "none", borderRadius: 6, cursor: pdfUrl ? "pointer" : "not-allowed", fontWeight: 600 }}>
              🖨️ Print
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ====== MAIN TICKET SCANNER ======
export default function TicketScanner({
  autoPrintOnValidate = false,
  mode = "badge",
  showDebug = false,
  stickerPageSize = { w: "80mm", h: "50mm" },
  onError,
  onSuccess,
}) {
  log("🔵 TicketScanner component rendering");

  // Refs
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const mountedRef = useRef(true);
  const lockedRef = useRef(false);
  const ticketIdRef = useRef(null);
  const validationRef = useRef(null);

  // State
  const [cameraState, setCameraState] = useState("initializing"); // "initializing" | "active" | "error" | "stopped"
  const [cameraError, setCameraError] = useState(null);
  const [message, setMessage] = useState("Initializing camera...");
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  // URLs
  const validateUrl = useMemo(() => apiUrl("/api/tickets/validate"), []);
  const printUrl = useMemo(() => apiUrl("/api/tickets/scan"), []);
  const isStickerMode = String(mode).toLowerCase() === "sticker";

  // ===== CAMERA =====
  function stopCamera() {
    log("🔵 Stopping camera");
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) { videoRef.current.srcObject = null; }
    setCameraState("stopped");
  }

  async function startCamera() {
    log("🔵 Starting camera...");
    setCameraError(null);
    stopCamera();
    setCameraState("initializing");
    setMessage("Requesting camera permission...");

    // Check if getUserMedia is available
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      const err = "Camera not available - requires HTTPS or localhost";
      log("🔴", err);
      setCameraError(err);
      setMessage(err);
      setCameraState("error");
      if (onError) onError(new Error(err));
      return;
    }

    try {
      log("🔵 Calling getUserMedia...");
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      if (!mountedRef.current) {
        log("🟡 Component unmounted, stopping");
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      log("🔵 Camera stream obtained");
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        log("🔵 Video playing");
      } else {
        log("🔴 Video ref is null!");
      }

      setCameraState("active");
      setMessage("Scanning for QR code...");

      // Start QR scanning loop
      const canvas = canvasRef.current;
      if (!canvas) {
        log("🔴 Canvas ref is null!");
        return;
      }
      const ctx = canvas.getContext("2d", { willReadFrequently: true });

      function tick() {
        if (!mountedRef.current) return;
        if (lockedRef.current) return;
        if (!videoRef.current || !canvasRef.current) return;
        if (videoRef.current.readyState < 2) {
          rafRef.current = requestAnimationFrame(tick);
          return;
        }

        try {
          canvas.width = videoRef.current.videoWidth;
          canvas.height = videoRef.current.videoHeight;
          ctx.drawImage(videoRef.current, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const qr = jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });

          if (qr && !lockedRef.current) {
            log("🔵 QR Code detected!");
            onQrDetected(qr.data);
            return;
          }
        } catch (e) {
          // Frame read errors are normal
        }

        if (mountedRef.current && !lockedRef.current) {
          rafRef.current = requestAnimationFrame(tick);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
      log("🔵 QR scanning loop started");
    } catch (err) {
      log("🔴 Camera error:", err.message || err);
      const errorMsg = err.message || String(err);
      setCameraError(errorMsg);
      setMessage("Camera error: " + errorMsg);
      setCameraState("error");
      if (onError) onError(err);
    }
  }

  // ===== QR DETECTION =====
  async function onQrDetected(data) {
    log("🔵 QR detected, data length:", data.length);
    lockedRef.current = true;
    stopCamera();

    const extracted = extractTicketId(String(data));
    log("🔵 Extracted ticket ID:", extracted);

    if (!extracted) {
      setMessage("No ticket ID found in QR code");
      setValidation({ ok: false, error: "Could not extract ticket ID" });
      setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 2000);
      return;
    }

    ticketIdRef.current = extracted;
    setTicketId(extracted);
    setMessage("Validating: " + extracted);

    try {
      log("🔵 Validating ticket:", extracted);
      const res = await fetch(validateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: extracted }),
        credentials: "include",
      });
      
      const json = await res.json().catch(() => ({}));
      log("🔵 Validation response:", res.status, json);

      if (!res.ok || !json.success) {
        setValidation({ ok: false, error: json.error || "Ticket not found" });
        setMessage("❌ " + (json.error || "Not matched"));
        setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 3000);
        return;
      }

      // SUCCESS
      log("🟢 Ticket validated successfully!");
      const val = { ok: true, ticket: json.ticket };
      validationRef.current = val;
      setValidation(val);
      setMessage("✅ Ticket matched!");
      
      if (onSuccess) onSuccess(json.ticket);

      if (!isStickerMode) {
        log("🟢 Opening badge modal");
        setModalOpen(true);
      }
      
      // lockedRef stays true - user must click "Scan Again"
    } catch (err) {
      log("🔴 Validation error:", err);
      setValidation({ ok: false, error: err.message });
      setMessage("Error: " + err.message);
      setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 3000);
    }
  }

  // ===== ACTIONS =====
  function handleScanAgain() {
    log("🔵 Scan Again clicked");
    setModalOpen(false);
    setValidation(null);
    setTicketId(null);
    ticketIdRef.current = null;
    validationRef.current = null;
    lockedRef.current = false;
    startCamera();
  }

  function handleCloseModal() {
    log("🔵 Close modal clicked");
    setModalOpen(false);
    setMessage("✅ Ticket matched — you can print again");
  }

  // ===== MOUNT =====
  useEffect(() => {
    log("🔵 Component mounted, starting camera");
    mountedRef.current = true;
    
    // Small delay to let DOM render
    const timer = setTimeout(() => {
      if (mountedRef.current) {
        startCamera();
      }
    }, 500);

    return () => {
      log("🔵 Component unmounting");
      clearTimeout(timer);
      mountedRef.current = false;
      stopCamera();
    };
  }, []);

  // ===== RENDER =====
  return (
    <div style={{ maxWidth: 500, margin: "0 auto", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ background: "white", borderRadius: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.08)", padding: 16 }}>
        
        {/* Camera Area */}
        <div style={{ marginBottom: 12 }}>
          {/* Error Banner */}
          {cameraError && (
            <div style={{ padding: 12, marginBottom: 8, background: "#fef2f2", borderRadius: 8, color: "#dc2626", fontSize: 13 }}>
              <strong>Camera Error:</strong> {cameraError}
              <div style={{ marginTop: 8, fontSize: 12 }}>
                Make sure you're using <strong>HTTPS</strong> or <strong>localhost</strong>, and you've allowed camera access.
              </div>
              <button onClick={startCamera} style={{ marginTop: 8, padding: "6px 12px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
                Try Again
              </button>
            </div>
          )}

          {/* Video or Placeholder */}
          {cameraState === "active" ? (
            <video ref={videoRef} style={{ width: "100%", maxHeight: 350, borderRadius: 8, background: "#000" }} playsInline muted autoPlay />
          ) : (
            <div style={{ width: "100%", height: 280, borderRadius: 8, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", padding: 20 }}>
                <div style={{ fontSize: 40, marginBottom: 8 }}>
                  {cameraState === "initializing" ? "📷" : cameraState === "error" ? "⚠️" : validation?.ok ? "✅" : "📷"}
                </div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {cameraState === "initializing" ? "Starting Camera..." : cameraState === "error" ? "Camera Error" : validation?.ok ? "Ticket Validated" : "Camera Off"}
                </div>
                <div style={{ fontSize: 13, color: "#6b7280", marginTop: 4 }}>
                  {message}
                </div>
                {cameraState !== "initializing" && !validation?.ok && (
                  <button onClick={startCamera} style={{ marginTop: 12, padding: "10px 24px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 600 }}>
                    Start Camera
                  </button>
                )}
              </div>
            </div>
          )}
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        {/* Debug Info */}
        {showDebug && (
          <div style={{ marginBottom: 8, padding: 8, background: "#f9fafb", borderRadius: 6, fontSize: 11, fontFamily: "monospace" }}>
            <div>Camera: {cameraState} | Locked: {lockedRef.current ? "Yes" : "No"} | Modal: {modalOpen ? "Open" : "Closed"}</div>
            <div>Ticket: {ticketId || "—"} | Validation: {validation ? (validation.ok ? "OK" : "FAIL") : "None"}</div>
          </div>
        )}

        {/* Validation Result */}
        {validation && !validation.ok && (
          <div style={{ padding: 12, background: "#fef2f2", borderRadius: 8, marginBottom: 8 }}>
            <strong style={{ color: "#991b1b" }}>Not Matched</strong>
            <div style={{ fontSize: 13, color: "#991b1b", marginTop: 4 }}>{validation.error}</div>
            <button onClick={handleScanAgain} style={{ marginTop: 8, padding: "6px 14px", background: "#fecaca", border: "none", borderRadius: 4, cursor: "pointer" }}>
              Try Again
            </button>
          </div>
        )}

        {validation && validation.ok && (
          <div style={{ padding: 12, background: "#f0fdf4", borderRadius: 8, marginBottom: 8 }}>
            <strong style={{ color: "#166534" }}>Ticket Matched</strong>
            {validation.ticket && (
              <div style={{ fontSize: 13, color: "#166534", marginTop: 4 }}>
                <div>Name: {validation.ticket.name || "—"}</div>
                <div>Company: {validation.ticket.company || "—"}</div>
              </div>
            )}
            <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
              {!isStickerMode && (
                <button onClick={() => setModalOpen(true)} style={{ padding: "8px 16px", background: "#196e87", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600 }}>
                  Print Badge
                </button>
              )}
              <button onClick={handleScanAgain} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>
                Scan Again
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Badge Modal */}
      {modalOpen && (
        <BadgeModal
          ticketId={ticketIdRef.current}
          validation={validationRef.current}
          printUrl={printUrl}
          onClose={handleCloseModal}
          onScanAgain={handleScanAgain}
        />
      )}
    </div>
  );
}