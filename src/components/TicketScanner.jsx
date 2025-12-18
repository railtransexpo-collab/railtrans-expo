import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

/*
  TicketScanner (patched)
  - Resolves backend using window.__API_BASE__ -> REACT_APP_API_BASE -> location.origin.
  - Defaults validate path to /api/tickets/validate (plural).
  - Logs the final request URL and server response (status + text/json).
  - Shows useful UI hints when the resolved URL looks wrong.
*/

function tryParseJsonSafe(str) {
  try { return JSON.parse(str); } catch (e) { return null; }
}
function looksLikeBase64(s) {
  return typeof s === "string" && /^[A-Za-z0-9+/=]+$/.test(s.replace(/\s+/g, "")) && s.length % 4 === 0;
}
function extractTicketIdFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const prefer = ["ticket_code","ticketCode","ticket_id","ticketId","ticket","code","c","id","t","tk"];
  for (const k of prefer) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      const v = obj[k];
      if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
    }
  }
  // nested search
  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (v && typeof v === "object") {
      const found = extractTicketIdFromObject(v);
      if (found) return found;
    }
  }
  return null;
}

function resolveApiBase() {
  // Prefer explicit global used elsewhere in your app
  if (typeof window !== "undefined" && window.__API_BASE__) {
    return String(window.__API_BASE__).replace(/\/$/, "");
  }
  // fallback env-style globals
  if (typeof window !== "undefined" && window.__BACKEND_ORIGIN__) {
    return String(window.__BACKEND_ORIGIN__).replace(/\/$/, "");
  }
  // fallback to build-time env (CRA)
  if (typeof process !== "undefined" && process.env) {
    const v = process.env.REACT_APP_API_BASE || process.env.API_BASE || "";
    if (v) return String(v).replace(/\/$/, "");
  }
  // last resort: same origin
  if (typeof window !== "undefined" && window.location && window.location.origin) {
    return String(window.location.origin).replace(/\/$/, "");
  }
  return "";
}

function resolveApiUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  const base = resolveApiBase();
  if (!base) return path.startsWith("/") ? path : `/${path}`;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export default function TicketScanner({
  apiValidate = null,
  apiPrint = null,
  apiPath = null,
  autoPrintOnValidate = false,
}) {
  // derive endpoints
  const derivedValidate = apiValidate || (apiPath ? apiPath.replace(/\/scan\/?$/, "/validate") : null);
  // default to plural "tickets" validate endpoint
  const validateUrl = resolveApiUrl(derivedValidate || "/api/tickets/validate");
  const printUrl = resolveApiUrl(apiPrint || (apiPath ? apiPath.replace(/\/scan\/?$/, "/print") : "/api/tickets/print"));

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [rawPayload, setRawPayload] = useState("");
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [message, setMessage] = useState("Scanning for QR…");
  const [lastValidateRequest, setLastValidateRequest] = useState(null);

  useEffect(() => {
    let mounted = true;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (!mounted) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");

        const tick = () => {
          if (!mounted) return;
          try {
            if (videoRef.current && videoRef.current.readyState === videoRef.current.HAVE_ENOUGH_DATA) {
              canvas.width = videoRef.current.videoWidth;
              canvas.height = videoRef.current.videoHeight;
              ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
              const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "attemptBoth" });

              if (code && !busy) {
                handleRawScan(code.data);
              }
            }
          } catch (e) {
            console.warn("frame read error", e && e.message);
          }
          rafRef.current = requestAnimationFrame(tick);
        };

        rafRef.current = requestAnimationFrame(tick);
      } catch (err) {
        console.error("Camera start error", err);
        setMessage(`Camera error: ${err.message || err}`);
      }
    }

    startCamera();

    return () => {
      mounted = false;
      try { if (rafRef.current) cancelAnimationFrame(rafRef.current); } catch {}
      try { if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop()); } catch {}
    };
  }, [busy]);

  async function handleRawScan(data) {
    setBusy(true);
    setRawPayload(String(data));
    setMessage("QR detected — extracting id...");
    console.log("[TicketScanner] RAW QR:", data);

    // extract ticket id
    let extracted = null;
    let parsed = tryParseJsonSafe(data);
    if (parsed) {
      extracted = extractTicketIdFromObject(parsed);
      console.log("[TicketScanner] parsed JSON, extracted:", extracted, parsed);
    } else {
      if (looksLikeBase64(data)) {
        try {
          const decoded = atob(String(data));
          parsed = tryParseJsonSafe(decoded);
          if (parsed) {
            extracted = extractTicketIdFromObject(parsed);
            console.log("[TicketScanner] decoded base64->json, extracted:", extracted);
          } else {
            const m = decoded.match(/\d{3,12}/);
            if (m) extracted = m[0];
          }
        } catch (e) {
          console.log("[TicketScanner] base64 decode failed", e);
        }
      }
      if (!extracted) {
        const jsonMatch = String(data).match(/\{.*\}/s);
        if (jsonMatch) {
          parsed = tryParseJsonSafe(jsonMatch[0]);
          if (parsed) extracted = extractTicketIdFromObject(parsed);
        }
      }
      if (!extracted) {
        const plain = String(data).trim();
        if (/^[A-Za-z0-9\-_.]{3,64}$/.test(plain)) extracted = plain;
        else {
          const m = plain.match(/\d{3,12}/);
          if (m) extracted = m[0];
        }
      }
    }

    if (!extracted) {
      setMessage("QR scanned but no ticket id found.");
      setValidation({ ok: false, error: "No ticket id extracted" });
      setBusy(false);
      setTimeout(() => setBusy(false), 700);
      return;
    }

    setTicketId(extracted);
    setMessage(`Validating ticket: ${extracted}...`);

    // If validateUrl looks wrong, show clear message
    if (!validateUrl) {
      setValidation({ ok: false, error: "validate endpoint not configured" });
      setMessage("Validation endpoint missing");
      setBusy(false);
      return;
    }

    // POST to validateUrl, log request/response
    try {
      console.info("[TicketScanner] POST", validateUrl, { ticketId: extracted });
      setLastValidateRequest({ url: validateUrl, payload: { ticketId: extracted }, time: Date.now() });

      const res = await fetch(validateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: extracted }),
        credentials: "same-origin",
      });

      const text = await res.text().catch(() => "");
      let js = null;
      try { js = text ? JSON.parse(text) : null; } catch { js = null; }
      console.info("[TicketScanner] validate response", res.status, js || text.slice(0, 1000));

      if (!res.ok) {
        // 405 handling: show helpful message
        let hint = "";
        if (res.status === 405) hint = "405 Method Not Allowed — the request may be hitting a static host or the endpoint expects a different method/path.";
        setValidation({ ok: false, error: (js && (js.error || js.message)) || text || `Validate failed (${res.status}) ${hint}` });
        setMessage("Ticket validation failed");
      } else {
        const ticket = (js && (js.ticket || js)) || {};
        setValidation({ ok: true, ticket });
        setMessage("Ticket validated ✔");
        if (autoPrintOnValidate) await doPrint(extracted);
      }
    } catch (e) {
      console.error("[TicketScanner] validate error", e);
      setValidation({ ok: false, error: e.message || String(e) });
      setMessage("Validation request error");
    } finally {
      setTimeout(() => setBusy(false), 800);
    }
  }

  async function doPrint(id) {
    if (!id) return;
    setMessage("Requesting print...");
    try {
      const res = await fetch(printUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: id }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        setMessage("Print request failed");
        setValidation({ ok: false, error: text || `Print failed (${res.status})` });
        return;
      }
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/pdf")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setMessage("PDF opened in new tab");
      } else {
        const text = await res.text().catch(() => "");
        setMessage("Print returned non-PDF response");
        console.log("[TicketScanner] print response:", text);
      }
    } catch (e) {
      console.error("Print error", e);
      setMessage("Print error");
    }
  }

  function renderValidation() {
    if (!validation) return null;
    if (!validation.ok) {
      return (
        <div className="p-3 bg-red-50 text-red-700 rounded">
          <div><strong>Not matched</strong></div>
          <div className="text-sm">{validation.error || "Ticket not found"}</div>
          {lastValidateRequest && (
            <div className="text-xs text-gray-500 mt-2">
              <div>Requested: <code>{lastValidateRequest.url}</code></div>
            </div>
          )}
        </div>
      );
    }
    const t = validation.ticket || {};
    return (
      <div className="p-3 bg-green-50 text-green-800 rounded">
        <div className="font-semibold">Matched</div>
        <div className="text-sm">{t.name || t.n || t.full_name || ""}</div>
        <div className="text-xs text-gray-700">{t.company || t.org || ""} — {t.category || t.cat || t.ticket_category || ""}</div>
        <div className="mt-2 flex gap-2">
          <button className="px-3 py-1 bg-[#196e87] text-white rounded" onClick={() => doPrint(ticketId)}>Print</button>
          <button className="px-3 py-1 bg-gray-100 rounded" onClick={() => { setValidation(null); setTicketId(null); setRawPayload(""); setMessage("Scanning for QR…"); }}>Reset</button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="bg-white rounded-lg shadow p-3">
        <div className="mb-3">
          <video ref={videoRef} style={{ width: "100%", maxHeight: 480, borderRadius: 8 }} playsInline muted />
          <canvas ref={canvasRef} style={{ display: "none" }} />
        </div>

        <div className="flex items-center justify-between mb-2">
          <div className="text-sm text-gray-700">{message}</div>
          <div className="text-xs text-gray-500">Status: {busy ? "busy" : "idle"}</div>
        </div>

        <div className="mb-3">
          <div className="text-xs text-gray-500">Raw payload (for debugging):</div>
          <pre className="bg-gray-50 p-2 rounded text-xs max-h-28 overflow-auto">{rawPayload || "—"}</pre>
        </div>

        <div className="mb-3">
          <div className="text-xs text-gray-500">Extracted ticket id:</div>
          <div className="font-mono text-sm p-2 bg-gray-50 rounded">{ticketId || "—"}</div>
        </div>

        <div>
          {renderValidation()}
        </div>
      </div>
    </div>
  );
}