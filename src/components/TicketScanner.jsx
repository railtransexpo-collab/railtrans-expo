import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

function tryParseJsonSafe(str) {
  try {
    return JSON.parse(str);
  } catch (e) {
    return null;
  }
}

function looksLikeBase64(s) {
  return (
    typeof s === "string" &&
    /^[A-Za-z0-9+/=]+$/.test(s.replace(/\s+/g, "")) &&
    s.length % 4 === 0
  );
}

function extractTicketIdFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const prefer = ["ticket_code", "ticketCode", "ticket_id", "ticketId", "ticket", "code", "c", "id", "t", "tk"];
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

function resolveApiUrl(p) {
  if (!p) return null;
  const s = String(p).trim();
  if (!s) return null;
  if (/^https?:\/\//i.test(s) || s.startsWith("data:")) return s;
  const base = (typeof window !== "undefined" && (window.__BACKEND_ORIGIN__ || window.__REACT_APP_API_BASE__ || null)) ||
               (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) ||
               (typeof window !== "undefined" && window.location && window.location.origin) ||
               "";
  if (!base) return s.startsWith("/") ? s : `/${s}`;
  return `${String(base).replace(/\/$/, "")}${s.startsWith("/") ? s : `/${s}`}`;
}

export default function TicketScanner({
  apiValidate = null,
  apiPrint = null,
  apiPath = null,
  autoPrintOnValidate = false,
}) {
  // derive endpoints if needed
  const derivedValidate = apiValidate || (apiPath ? apiPath.replace(/\/scan\/?$/, "/validate") : null);
  const derivedPrint = apiPrint || (apiPath ? apiPath.replace(/\/scan\/?$/, "/print") : null);

  const validateUrl = resolveApiUrl(derivedValidate || "/api/tickets/validate");
  const printUrl = resolveApiUrl(derivedPrint || "/api/tickets/print");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const streamRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [rawPayload, setRawPayload] = useState("");
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null); // { ok, ticket } or { ok:false, error }
  const [message, setMessage] = useState("Scanning for QR…");

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
            // continue - occasionally getImageData may throw on some devices
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  async function handleRawScan(data) {
    setBusy(true);
    setRawPayload(String(data));
    setMessage("QR detected — extracting id...");
    console.log("[TicketScanner] RAW QR:", data);

    // Attempt to extract ticket id
    let extracted = null;
    let parsed = tryParseJsonSafe(data);
    if (parsed) {
      extracted = extractTicketIdFromObject(parsed);
      console.log("[TicketScanner] parsed JSON, extracted:", extracted, "parsed obj:", parsed);
    } else {
      // maybe it's base64 JSON
      if (looksLikeBase64(data)) {
        try {
          // atob can throw if not valid base64
          const decoded = atob(String(data));
          parsed = tryParseJsonSafe(decoded);
          if (parsed) {
            extracted = extractTicketIdFromObject(parsed);
            console.log("[TicketScanner] decoded base64->json, extracted:", extracted, "decoded:", decoded);
          } else {
            // decode plain and try numeric substring
            const m = decoded.match(/\d{3,12}/);
            if (m) extracted = m[0];
          }
        } catch (e) {
          console.log("[TicketScanner] base64 decode failed or not JSON", e);
        }
      }

      // If still not parsed, scan for JSON-like substring
      if (!extracted) {
        const jsonMatch = String(data).match(/\{.*\}/s);
        if (jsonMatch) {
          parsed = tryParseJsonSafe(jsonMatch[0]);
          if (parsed) {
            extracted = extractTicketIdFromObject(parsed);
            console.log("[TicketScanner] found JSON substring, extracted:", extracted);
          }
        }
      }

      // fallback: plain token or numeric code
      if (!extracted) {
        const plain = String(data).trim();
        if (/^[A-Za-z0-9\-_.]{3,64}$/.test(plain)) {
          extracted = plain;
          console.log("[TicketScanner] treated raw as plain code:", plain);
        } else {
          // try extracting digits
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

    // we have an extracted id - validate with backend
    setTicketId(extracted);
    setMessage(`Validating ticket: ${extracted}...`);
    try {
      // Use validateUrl which should be absolute (resolveApiUrl handled relative)
      const res = await fetch(validateUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" }, // keep preflight minimal
        body: JSON.stringify({ ticketId: extracted }),
      });

      const js = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.warn("[TicketScanner] validate non-ok", res.status, js);
        setValidation({ ok: false, error: js?.error || `Validate failed (${res.status})` });
        setMessage("Ticket validation failed");
      } else {
        setValidation({ ok: true, ticket: js.ticket || js });
        setMessage("Ticket validated ✔");
        if (autoPrintOnValidate) {
          await doPrint(extracted);
        }
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
      });
      if (!res.ok) {
        const js = await res.json().catch(() => null);
        setMessage("Print request failed");
        setValidation({ ok: false, error: js?.error || `Print failed (${res.status})` });
        return;
      }
      const contentType = res.headers.get("content-type") || "";
      if (contentType.includes("application/pdf")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
        setMessage("PDF opened in new tab");
      } else {
        const js = await res.json().catch(() => null);
        console.log("[TicketScanner] print response:", js);
        setMessage("Print returned non-PDF response");
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