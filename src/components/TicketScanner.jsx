import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import jsQR from "jsqr";

console.log("🔵 [TicketScanner] Module loaded");

const API_BASE =
  (typeof process !== "undefined" && process.env?.REACT_APP_API_BASE) ||
  (typeof window !== "undefined" && (window.__API_BASE__ || window.__BACKEND_ORIGIN__)) ||
  (typeof window !== "undefined" && window.location?.origin) ||
  "";

function apiUrl(path) {
  if (!path) return "";
  const s = String(path).trim();
  if (/^https?:\/\//i.test(s)) return s;
  const base = String(API_BASE).replace(/\/$/, "");
  return `${base}${s.startsWith("/") ? s : `/${s}`}`;
}

function extractTicketIdFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const priorityKeys = ["ticket_code", "ticketCode", "code", "ticketId", "ticket_id", "id"];
  for (const k of priorityKeys) {
    if (obj[k] !== undefined && obj[k] !== null) {
      const val = String(obj[k]).trim();
      if (val) return val;
    }
  }
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === "object") {
      const found = extractTicketIdFromObject(v);
      if (found) return found;
    }
  }
  return null;
}

function extractTicketId(input) {
  if (!input) return null;
  const s = String(input).trim();
  try {
    const parsed = JSON.parse(s);
    if (parsed && typeof parsed === "object") {
      const fromObj = extractTicketIdFromObject(parsed);
      if (fromObj) return fromObj;
    }
  } catch (_) {}
  const numericMatch = s.match(/\b\d{6,8}\b/);
  if (numericMatch) return numericMatch[0];
  const alnumMatch = s.match(/[A-Za-z0-9]{6,12}/);
  return alnumMatch ? alnumMatch[0] : null;
}

function extractNameAndOrganization(ticket) {
  if (!ticket || typeof ticket !== "object") return { name: "", organization: "" };
  const nameFields = ["name", "full_name", "fullName", "visitor_name", "attendee_name", "n"];
  let name = "";
  for (const field of nameFields) {
    if (ticket[field]) { name = String(ticket[field]).trim(); if (name) break; }
  }
  const orgFields = ["company", "organization", "org", "company_name", "companyName", "employer", "affiliation"];
  let organization = "";
  for (const field of orgFields) {
    if (ticket[field]) { organization = String(ticket[field]).trim(); if (organization) break; }
  }
  if (!name && ticket.data && typeof ticket.data === "object") {
    name = ticket.data.name || ticket.data.full_name || "";
    organization = ticket.data.company || ticket.data.organization || "";
  }
  return { name: name || "Guest", organization: organization || "Visitor" };
}

// ── Portal Badge Modal ────────────────────────────────────────────────────────
function BadgeModal({ ticketId, validation, printUrl, onClose, onScanAgain }) {
  console.log("🟢 [BadgeModal] Rendering for ticket:", ticketId);
  
  const [status, setStatus] = useState("loading"); // "loading" | "ready" | "error"
  const [pdfUrl, setPdfUrl] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const pdfUrlRef = useRef(null);
  const mountedRef = useRef(true);
  const fetchAttemptedRef = useRef(false);

  // Fetch PDF
  useEffect(() => {
    console.log("🟢 [BadgeModal] useEffect for PDF fetch, ticketId:", ticketId);
    
    if (!ticketId) {
      console.log("🔴 [BadgeModal] No ticketId, setting error");
      setStatus("error");
      setErrorMsg("No ticket ID provided");
      return;
    }

    if (fetchAttemptedRef.current) {
      console.log("🟡 [BadgeModal] Fetch already attempted, skipping");
      return;
    }

    fetchAttemptedRef.current = true;
    let cancelled = false;

    async function fetchPdf() {
      console.log("🟢 [BadgeModal] Starting PDF fetch for:", ticketId);
      setStatus("loading");
      
      try {
        const res = await fetch(printUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId: String(ticketId) }),
          credentials: "include",
        });

        console.log("🟢 [BadgeModal] Response status:", res.status);

        if (!res.ok) {
          const js = await res.json().catch(() => null);
          throw new Error(js?.error || `Server error ${res.status}`);
        }

        const ct = res.headers.get("content-type") || "";
        console.log("🟢 [BadgeModal] Content-Type:", ct);
        
        if (!ct.includes("application/pdf")) {
          throw new Error("Server did not return a PDF (got: " + ct + ")");
        }

        const blob = await res.blob();
        console.log("🟢 [BadgeModal] Blob size:", blob.size, "bytes");

        if (cancelled) {
          console.log("🟡 [BadgeModal] Cancelled after blob");
          return;
        }

        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
        setStatus("ready");
        console.log("🟢 [BadgeModal] PDF loaded successfully, URL:", url.substring(0, 50) + "...");
      } catch (err) {
        console.error("🔴 [BadgeModal] Fetch error:", err);
        if (!cancelled) {
          setStatus("error");
          setErrorMsg(err.message || "Unknown error");
        }
      }
    }

    fetchPdf();

    return () => {
      console.log("🟡 [BadgeModal] Cleanup - cancelling fetch");
      cancelled = true;
    };
  }, [ticketId, printUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      console.log("🟡 [BadgeModal] Unmounting, revoking URL");
      mountedRef.current = false;
      if (pdfUrlRef.current) {
        URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = null;
      }
    };
  }, []);

  function handlePrint() {
    console.log("🟢 [BadgeModal] handlePrint called, pdfUrl:", pdfUrl);
    if (!pdfUrl) return;

    // Method 1: Try window.open
    const win = window.open(pdfUrl, "_blank", "width=800,height=600");
    if (win) {
      console.log("🟢 [BadgeModal] Window opened, waiting for load");
      const checkInterval = setInterval(() => {
        try {
          if (win.document && win.document.readyState === "complete") {
            console.log("🟢 [BadgeModal] Window loaded, printing");
            clearInterval(checkInterval);
            setTimeout(() => win.print(), 300);
          }
        } catch (e) {
          clearInterval(checkInterval);
        }
      }, 200);
    } else {
      console.log("🟡 [BadgeModal] Window blocked, using iframe fallback");
      // Method 2: iframe fallback
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;top:0;left:0;width:100%;height:100%;z-index:999999;border:none;";
      iframe.src = pdfUrl;
      iframe.id = "badge-print-frame-" + Date.now();
      document.body.appendChild(iframe);
      iframe.onload = () => {
        console.log("🟢 [BadgeModal] Iframe loaded, printing");
        setTimeout(() => {
          try {
            iframe.contentWindow.focus();
            iframe.contentWindow.print();
          } catch (e) {
            console.error("🔴 [BadgeModal] Iframe print failed:", e);
            alert("Print failed. Please try again or use Ctrl+P after the PDF opens.");
          }
        }, 500);
      };
    }
  }

  function handleRetry() {
    console.log("🟢 [BadgeModal] Retry triggered");
    if (pdfUrlRef.current) {
      URL.revokeObjectURL(pdfUrlRef.current);
      pdfUrlRef.current = null;
    }
    setPdfUrl(null);
    setErrorMsg(null);
    setStatus("loading");
    fetchAttemptedRef.current = false;

    // Re-trigger fetch by forcing re-render with key change? No, we do it manually
    async function retryFetch() {
      try {
        const res = await fetch(printUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ticketId: String(ticketId) }),
          credentials: "include",
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "Failed");
        const blob = await res.blob();
        if (!mountedRef.current) return;
        const url = URL.createObjectURL(blob);
        pdfUrlRef.current = url;
        setPdfUrl(url);
        setStatus("ready");
      } catch (err) {
        if (mountedRef.current) {
          setStatus("error");
          setErrorMsg(err.message);
        }
      }
    }
    retryFetch();
  }

  const attendeeName = validation?.ticket?.name || "";

  return createPortal(
    <div
      style={{
        position: "fixed",
        top: 0, left: 0, right: 0, bottom: 0,
        zIndex: 99999,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.6)",
      }}
      onClick={(e) => {
        // Don't close when clicking backdrop - user must use buttons
        e.stopPropagation();
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 12,
          boxShadow: "0 25px 80px rgba(0,0,0,0.4)",
          width: "100%",
          maxWidth: 880,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "14px 20px", borderBottom: "1px solid #e5e7eb", flexShrink: 0 }}>
          <strong style={{ fontSize: 16 }}>Badge Preview — {ticketId}</strong>
          <button onClick={onClose} style={{ background: "none", border: "none", fontSize: 26, cursor: "pointer", color: "#6b7280", lineHeight: 1 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 450, overflow: "auto", display: "flex", flexDirection: "column" }}>
          {status === "loading" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>⏳</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>Loading badge...</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>Fetching PDF from server</div>
              <div style={{ fontSize: 12, marginTop: 4, color: "#9ca3af" }}>Ticket: {ticketId}</div>
            </div>
          )}

          {status === "error" && (
            <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", color: "#dc2626", padding: 20 }}>
              <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>Error Loading Badge</div>
              <div style={{ fontSize: 13, marginTop: 8, textAlign: "center", maxWidth: 400 }}>{errorMsg}</div>
              <button onClick={handleRetry} style={{ marginTop: 16, padding: "10px 24px", background: "#fee2e2", color: "#dc2626", border: "none", borderRadius: 6, cursor: "pointer", fontWeight: 600, fontSize: 14 }}>
                🔄 Retry
              </button>
            </div>
          )}

          {status === "ready" && pdfUrl && (
            <iframe
              src={pdfUrl}
              style={{ flex: 1, width: "100%", minHeight: 450, border: "none" }}
              title="Badge Preview"
            />
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 20px", borderTop: "1px solid #e5e7eb", background: "#f9fafb", flexShrink: 0 }}>
          <div style={{ fontSize: 13, color: "#6b7280" }}>
            {attendeeName && <span>Attendee: <strong>{attendeeName}</strong></span>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onScanAgain} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>
              🔄 Scan Again
            </button>
            <button onClick={onClose} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>
              Close
            </button>
            <button onClick={handlePrint} disabled={status !== "ready"} style={{ padding: "8px 20px", border: "none", borderRadius: 6, cursor: status === "ready" ? "pointer" : "not-allowed", fontSize: 14, fontWeight: 600, background: status === "ready" ? "#196e87" : "#9ca3af", color: "#fff" }}>
              🖨️ Print
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Main Scanner ──────────────────────────────────────────────────────────────
export default function TicketScanner({
  autoPrintOnValidate = false,
  mode = "badge",
  showDebug = false,
  stickerPageSize = { w: "80mm", h: "50mm" },
  onError,
  onSuccess,
}) {
  console.log("🔵 [TicketScanner] Component function called");

  // Refs - survive re-renders
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const rafRef = useRef(null);
  const mountedRef = useRef(true);
  const lockedRef = useRef(false);
  const ticketIdRef = useRef(null);
  const validationRef = useRef(null);
  const cameraStartedRef = useRef(false);

  // State
  const [message, setMessage] = useState("Initializing camera...");
  const [showVideo, setShowVideo] = useState(false);
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [rawPayload, setRawPayload] = useState("");
  const [modalOpen, setModalOpen] = useState(false);

  // URLs
  const validateUrl = useMemo(() => apiUrl("/api/tickets/validate"), []);
  const printUrl = useMemo(() => apiUrl("/api/tickets/scan"), []);
  const isStickerMode = String(mode).toLowerCase() === "sticker";

  const stickerData = useMemo(() => {
    if (!validation?.ok || !validation.ticket) return { name: "", organization: "" };
    return extractNameAndOrganization(validation.ticket);
  }, [validation]);

  // ===== CAMERA FUNCTIONS (plain functions, no useCallback) =====

  function stopCamera() {
    console.log("🔵 [TicketScanner] stopCamera called");
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
    setShowVideo(false);
  }

  async function startCamera() {
    console.log("🔵 [TicketScanner] startCamera called, cameraStartedRef:", cameraStartedRef.current);
    
    stopCamera();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });

      if (!mountedRef.current) {
        stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      setShowVideo(true);
      setMessage("Scanning for QR code...");
      cameraStartedRef.current = true;
      console.log("🔵 [TicketScanner] Camera started successfully");

      const canvas = canvasRef.current;
      if (!canvas) return;
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
            console.log("🔵 [TicketScanner] QR code detected!");
            onQrDetected(qr.data);
            return;
          }
        } catch (e) {
          // Silently ignore frame read errors
        }

        if (mountedRef.current && !lockedRef.current) {
          rafRef.current = requestAnimationFrame(tick);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      console.error("🔴 [TicketScanner] Camera error:", err);
      setMessage("Camera error: " + (err.message || err));
      setShowVideo(false);
      cameraStartedRef.current = false;
    }
  }

  // ===== QR DETECTION =====

  async function onQrDetected(data) {
    console.log("🔵 [TicketScanner] onQrDetected, locking scanner");
    lockedRef.current = true;
    stopCamera();

    setRawPayload(String(data));
    setMessage("QR detected — processing...");
    setValidation(null);

    const extracted = extractTicketId(String(data));
    if (!extracted) {
      console.log("🔴 [TicketScanner] No ticket ID found in QR");
      setMessage("No ticket ID found in QR code");
      setValidation({ ok: false, error: "No ticket ID extracted" });
      if (onError) onError(new Error("No ticket ID extracted"));
      setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 2000);
      return;
    }

    ticketIdRef.current = extracted;
    setTicketId(extracted);
    setMessage("Validating ticket: " + extracted + "...");

    try {
      const res = await fetch(validateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: extracted }),
        credentials: "include",
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.success) {
        console.log("🔴 [TicketScanner] Ticket not matched");
        setValidation({ ok: false, error: json.error || "Ticket not found" });
        setMessage("❌ Ticket not matched");
        if (onError) onError(new Error(json.error || "Ticket not found"));
        setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 2000);
        return;
      }

      // SUCCESS
      console.log("🟢 [TicketScanner] Ticket matched!");
      const val = { ok: true, ticket: json.ticket };
      validationRef.current = val;
      setValidation(val);
      setMessage("✅ Ticket matched");
      if (onSuccess) onSuccess(json.ticket);

      if (isStickerMode) {
        if (autoPrintOnValidate) {
          printSticker({ ...extractNameAndOrganization(json.ticket), page: stickerPageSize });
        }
      } else {
        // Open the modal
        console.log("🟢 [TicketScanner] Opening badge modal");
        setModalOpen(true);
      }

      // lockedRef stays TRUE - scanner remains locked
    } catch (err) {
      console.error("🔴 [TicketScanner] Validation error:", err);
      setValidation({ ok: false, error: err.message });
      setMessage("Validation error");
      setTimeout(() => { if (mountedRef.current) lockedRef.current = false; }, 2000);
    }
  }

  // ===== SCAN AGAIN =====

  function handleScanAgain() {
    console.log("🔵 [TicketScanner] handleScanAgain called");
    setModalOpen(false);
    setValidation(null);
    setTicketId(null);
    setRawPayload("");
    ticketIdRef.current = null;
    validationRef.current = null;
    lockedRef.current = false;
    startCamera();
  }

  // ===== CLOSE MODAL =====

  function handleCloseModal() {
    console.log("🔵 [TicketScanner] handleCloseModal called");
    setModalOpen(false);
    setMessage("✅ Ticket matched — you can print again or scan another");
  }

  // ===== MOUNT - Start camera ONCE =====
  useEffect(() => {
    console.log("🔵 [TicketScanner] Mount effect running");
    mountedRef.current = true;
    
    // Small delay to ensure DOM is ready
    const timer = setTimeout(() => {
      if (mountedRef.current && !cameraStartedRef.current) {
        startCamera();
      }
    }, 300);

    return () => {
      console.log("🔵 [TicketScanner] Unmount effect running");
      clearTimeout(timer);
      mountedRef.current = false;
      stopCamera();
    };
  }, []); // EMPTY dependency array - runs ONLY on mount/unmount

  // ===== RENDER =====
  console.log("🔵 [TicketScanner] Rendering, modalOpen:", modalOpen, "showVideo:", showVideo);

  function renderValidation() {
    if (!validation) return null;

    if (!validation.ok) {
      return (
        <div style={{ padding: 12, background: "#fef2f2", borderRadius: 8, color: "#991b1b", marginTop: 8 }}>
          <strong>Not matched</strong>
          <div style={{ fontSize: 13 }}>{validation.error || "Ticket not found"}</div>
          <button onClick={handleScanAgain} style={{ marginTop: 8, padding: "6px 14px", background: "#fecaca", border: "none", borderRadius: 4, cursor: "pointer" }}>
            Scan again
          </button>
        </div>
      );
    }

    if (isStickerMode) {
      return (
        <div style={{ padding: 12, background: "#fff", borderRadius: 8, border: "1px solid #e5e7eb", marginTop: 8 }}>
          <div style={{ background: "#f9fafb", padding: 12, borderRadius: 6 }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: "#1B3A8A" }}>{stickerData.name || "—"}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: "#374151", marginTop: 4 }}>{stickerData.organization || "—"}</div>
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <button onClick={() => printSticker({ ...stickerData, page: stickerPageSize })} style={{ padding: "8px 16px", background: "#196e87", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}>
              🖨️ Print Sticker
            </button>
            <button onClick={handleScanAgain} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>
              Scan again
            </button>
          </div>
        </div>
      );
    }

    const t = validation.ticket || {};
    return (
      <div style={{ padding: 12, background: "#f0fdf4", borderRadius: 8, color: "#166534", marginTop: 8 }}>
        <strong>✅ Ticket Matched</strong>
        <div style={{ fontSize: 13, marginTop: 4 }}>
          <div>Name: {t.name || "—"}</div>
          <div>Company: {t.company || "—"}</div>
          {t.category && <div>Category: {t.category}</div>}
        </div>
        <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
          <button
            onClick={() => {
              console.log("🔵 [TicketScanner] Print Badge button clicked, ticketId:", ticketIdRef.current);
              setModalOpen(true);
            }}
            style={{ padding: "8px 16px", background: "#196e87", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer" }}
          >
            🖨️ Print Badge
          </button>
          <button onClick={handleScanAgain} style={{ padding: "8px 16px", background: "#e5e7eb", border: "none", borderRadius: 6, cursor: "pointer" }}>
            Scan again
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div style={{ background: "#fff", borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.1)", padding: 16 }}>
        {/* Video / Placeholder */}
        <div style={{ marginBottom: 12 }}>
          {showVideo ? (
            <video ref={videoRef} style={{ width: "100%", maxHeight: 420, borderRadius: 8, background: "#000" }} playsInline muted autoPlay />
          ) : (
            <div style={{ width: "100%", height: 320, borderRadius: 8, background: "#f3f4f6", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <div style={{ textAlign: "center", color: "#6b7280" }}>
                <div style={{ fontSize: 48, marginBottom: 8 }}>{validation?.ok ? "✅" : "📷"}</div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{validation?.ok ? "Ticket Validated" : "Camera Off"}</div>
                <div style={{ fontSize: 14, marginTop: 4 }}>
                  {validation?.ok ? "Ready to print" : message.includes("error") ? "Camera error" : "Camera stopped"}
                </div>
                {!validation?.ok && !showVideo && !message.includes("Scanning") && (
                  <button onClick={startCamera} style={{ marginTop: 12, padding: "10px 20px", background: "#3b82f6", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 14 }}>
                    🔄 Start Camera
                  </button>
                )}
              </div>
            </div>
          )}
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        {/* Message */}
        <div style={{ fontSize: 14, color: "#374151", marginBottom: 8 }}>{message}</div>

        {/* Debug info */}
        {showDebug && (
          <div style={{ fontSize: 11, marginBottom: 8, padding: 8, background: "#f9fafb", borderRadius: 4 }}>
            <div>Ticket: {ticketId || "—"}</div>
            <div>Raw: {rawPayload ? rawPayload.substring(0, 50) + "..." : "—"}</div>
            <div>Locked: {lockedRef.current ? "Yes" : "No"}</div>
            <div>Modal: {modalOpen ? "Open" : "Closed"}</div>
            <div>Camera: {cameraStartedRef.current ? "Started" : "Not started"}</div>
          </div>
        )}

        {/* Validation result */}
        {renderValidation()}
      </div>

      {/* Portal Modal */}
      {modalOpen && (
        <BadgeModal
          ticketId={ticketIdRef.current}
          validation={validationRef.current}
          printUrl={printUrl}
          onClose={handleCloseModal}
          onScanAgain={handleScanAgain}
        />
      )}
    </>
  );
}