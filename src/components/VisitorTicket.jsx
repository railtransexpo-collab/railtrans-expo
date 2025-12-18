import React, { useCallback, useEffect, useRef, useState } from "react";

/**
 * VisitorTicket (robust)
 *
 * - Tries to fetch visitor by id using candidate URLs (relative then API_BASE absolute).
 * - Falls back to q= search (ticket_code) when direct id lookup fails.
 * - Accepts multiple response shapes: object, { data: ... }, [ ... ].
 * - Extracts ticket_code from multiple fields and updates UI.
 * - Logs candidate URLs used for debugging.
 */

/* ---------- helpers ---------- */
function base64ToBlob(base64, contentType = "application/pdf") {
  try {
    const b64 = base64.indexOf("base64,") >= 0 ? base64.split("base64,")[1] : base64;
    const byteChars = atob(b64);
    const byteNumbers = new Array(byteChars.length);
    for (let i = 0; i < byteChars.length; i++) {
      byteNumbers[i] = byteChars.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: contentType });
  } catch (e) {
    return null;
  }
}

function resolveApiBase() {
  try {
    if (typeof window !== "undefined" && (window.__API_BASE__ || window.__API_BASE__)) {
      return String(window.__API_BASE__ || window.__API_BASE__).replace(/\/$/, "");
    }
  } catch (e) {}
  try {
    if (typeof process !== "undefined" && process.env) {
      return String(process.env.REACT_APP_API_BASE || process.env.API_BASE || "").replace(/\/$/, "");
    }
  } catch (e) {}
  return "";
}

function buildApiUrl(apiBase, path) {
  if (!path) return apiBase || path;
  if (/^https?:\/\//i.test(path)) return path;
  if (!apiBase) return path.startsWith("/") ? path : `/${path}`;
  if (path.startsWith("/")) return `${apiBase}${path}`;
  return `${apiBase}/${path}`;
}

async function tryFetchJsonCandidates(candidates = []) {
  for (const url of candidates) {
    try {
      console.debug("[VisitorTicket] trying:", url);
      const res = await fetch(url, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      const ct = (res && res.headers && typeof res.headers.get === "function") ? (res.headers.get("content-type") || "") : "";
      // prefer json responses
      if (!res.ok) {
        // skip if 404 (try other candidates)
        if (res.status === 404) continue;
        // non-404 -> still try to parse if possible for debugging
      }
      // If content-type not JSON, skip candidate (likely index.html)
      if (!ct.toLowerCase().includes("application/json")) {
        // attempt to read text for debugging, but don't treat as success
        const txt = await res.text().catch(() => "");
        console.warn("[VisitorTicket] candidate returned non-json content, skipping:", url, "content-snippet:", txt ? txt.slice(0, 800) : "(empty)");
        continue;
      }
      const js = await res.json().catch(() => null);
      if (js !== null) return { ok: true, url, body: js, status: res.status };
    } catch (e) {
      console.warn("[VisitorTicket] candidate fetch failed:", url, e && e.message ? e.message : e);
      continue;
    }
  }
  return { ok: false };
}

function extractTicketCodeFromResponse(js) {
  if (!js) return "";
  // support shapes: { ticket_code }, { data: { ticket_code } }, { rows: [...] }, array, nested fields
  const candidates = [];

  if (Array.isArray(js)) {
    for (const it of js) {
      if (it && typeof it === "object") candidates.push(it);
    }
  } else if (js && typeof js === "object") {
    // If API uses { data: ... } wrapper
    if (js.data && typeof js.data === "object") {
      if (Array.isArray(js.data)) js.data.forEach(d => candidates.push(d));
      else candidates.push(js.data);
    } else if (Array.isArray(js.rows)) {
      js.rows.forEach(d => candidates.push(d));
    } else {
      candidates.push(js);
    }
  }

  for (const obj of candidates) {
    if (!obj || typeof obj !== "object") continue;
    const t = obj.ticket_code || obj.ticketCode || obj.code || obj.ticketId || obj.codeId || obj.code_id;
    if (t && String(t).trim()) return String(t).trim();
    // also look nested in form/data
    if (obj.form && typeof obj.form === "object") {
      const f = obj.form.ticket_code || obj.form.ticketCode || obj.form.code || obj.form.ticketId;
      if (f && String(f).trim()) return String(f).trim();
    }
    if (obj.data && typeof obj.data === "object") {
      const d = obj.data.ticket_code || obj.data.ticketCode || obj.data.code || obj.data.ticketId;
      if (d && String(d).trim()) return String(d).trim();
    }
  }
  return "";
}

/* ---------- component ---------- */
export default function VisitorTicket({
  visitor,
  pdfBlob,
  roleLabel,
  accentColor = "#c8102e",
  showQRCode = true,
  qrSize = 220,
  className = "",
}) {
  const [downloadUrl, setDownloadUrl] = useState(null);
  const downloadUrlRef = useRef(null);
  const cardRef = useRef(null);

  const [localTicketCode, setLocalTicketCode] = useState(
    visitor ? (visitor.ticket_code || visitor.ticketCode || visitor.ticketId || "") : ""
  );
  const [fetchingServerCode, setFetchingServerCode] = useState(false);
  const [fetchError, setFetchError] = useState("");
  const [lastTriedUrls, setLastTriedUrls] = useState([]);

  const [debugInfo, setDebugInfo] = useState(null);

  useEffect(() => {
    if (!pdfBlob) {
      if (downloadUrlRef.current) {
        try { URL.revokeObjectURL(downloadUrlRef.current); } catch {}
        downloadUrlRef.current = null;
      }
      setDownloadUrl(null);
      return;
    }
    if (typeof pdfBlob === "string") {
      if (pdfBlob.startsWith("data:")) {
        setDownloadUrl(pdfBlob);
        downloadUrlRef.current = null;
        return;
      }
      const b = base64ToBlob(pdfBlob, "application/pdf");
      if (b) {
        const url = URL.createObjectURL(b);
        setDownloadUrl(url);
        downloadUrlRef.current = url;
        return;
      }
      setDownloadUrl(null);
      return;
    }
    if (pdfBlob instanceof Blob) {
      const url = URL.createObjectURL(pdfBlob);
      setDownloadUrl(url);
      downloadUrlRef.current = url;
      return;
    }
    setDownloadUrl(null);
    return () => {
      if (downloadUrlRef.current) {
        try { URL.revokeObjectURL(downloadUrlRef.current); } catch {}
        downloadUrlRef.current = null;
      }
    };
  }, [pdfBlob]);

  useEffect(() => {
    if (!visitor) {
      setLocalTicketCode("");
      return;
    }
    const canonical = visitor.ticket_code || visitor.ticketCode || visitor.ticketId || "";
    setLocalTicketCode(canonical ? String(canonical).trim() : "");
  }, [visitor]);

  const v = visitor || {};
  const name = v.name || v.full_name || v.title || "";
  const company = v.company || v.organization || "";
  const ticketCategory = (v.ticket_category || v.category || roleLabel || "VISITOR").toString().toUpperCase();
  const providedTicketCode = v.ticket_code || v.ticketCode || v.ticketId || "";

  const qrData = localTicketCode || providedTicketCode || "";
  const qrUrl = qrData
    ? `https://chart.googleapis.com/chart?cht=qr&chs=${qrSize}x${qrSize}&chl=${encodeURIComponent(qrData)}&choe=UTF-8`
    : null;

  const handleDownload = useCallback(() => {
    if (!downloadUrl) return;
    const a = document.createElement("a");
    const filenameSafe = (name || "ticket").replace(/\s+/g, "_");
    a.href = downloadUrl;
    a.download = `RailTransExpo-${filenameSafe}.pdf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }, [downloadUrl, name]);

  const handlePrintCard = useCallback(() => {
    if (!cardRef.current) {
      window.print();
      return;
    }
    const cardHtml = cardRef.current.outerHTML;
    const win = window.open("", "_blank", "noopener,noreferrer");
    if (!win) {
      window.print();
      return;
    }
    const style = `
      <style>
        body { margin: 0; font-family: Helvetica, Arial, sans-serif; display:flex; align-items:center; justify-content:center; background: #f3f4f6; }
        .ticket-wrapper { padding: 24px; }
      </style>
    `;
    win.document.write(`<!doctype html><html><head><meta charset="utf-8">${style}</head><body><div class="ticket-wrapper">${cardHtml}</div></body></html>`);
    win.document.close();
    win.onload = () => {
      try {
        win.focus();
        win.print();
        setTimeout(() => { try { win.close(); } catch {} }, 500);
      } catch (e) {
        console.warn("Print failed", e);
      }
    };
  }, []);

  const apiBase = resolveApiBase();

  const fetchCanonicalTicketCode = useCallback(async () => {
    setFetchError("");
    setFetchingServerCode(true);
    setLastTriedUrls([]);
    setDebugInfo(null);

    try {
      // prefer v.id if available
      const entityId = v && (v.id || v._id || v._id && v._id.$oid) ? String(v.id || v._id || (v._id && v._id.$oid)) : "";
      const candidatesTried = [];

      // helpers to build candidate lists
      const idCandidates = (idVal) => {
        const rel = `/api/visitors/${encodeURIComponent(String(idVal))}`;
        const abs = buildApiUrl(apiBase, `/api/visitors/${encodeURIComponent(String(idVal))}`);
        return [rel, abs];
      };
      const qCandidates = (q) => {
        const rel = `/api/visitors?q=${encodeURIComponent(q)}&limit=1`;
        const abs = buildApiUrl(apiBase, `/api/visitors?q=${encodeURIComponent(q)}&limit=1`);
        return [rel, abs];
      };

      let result = null;

      if (entityId) {
        const candidates = idCandidates(entityId);
        candidatesTried.push(...candidates);
        const out = await tryFetchJsonCandidates(candidates);
        if (out.ok) result = out.body;
        else {
          // try treating id as ticket_code (q=)
          const fallback = qCandidates(entityId);
          candidatesTried.push(...fallback);
          const out2 = await tryFetchJsonCandidates(fallback);
          if (out2.ok) result = out2.body;
        }
      }

      // If no id or still nothing, try provided ticket_code in visitor prop
      if (!result && providedTicketCode) {
        const cands = qCandidates(providedTicketCode);
        candidatesTried.push(...cands);
        const out = await tryFetchJsonCandidates(cands);
        if (out.ok) result = out.body;
      }

      // As a last resort, try the tickets collection by id (some setups store ticket in tickets)
      if (!result && entityId) {
        const rel = `/api/tickets/${encodeURIComponent(String(entityId))}`;
        const abs = buildApiUrl(apiBase, `/api/tickets/${encodeURIComponent(String(entityId))}`);
        candidatesTried.push(rel, abs);
        const out = await tryFetchJsonCandidates([rel, abs]);
        if (out.ok) result = out.body;
      }

      setLastTriedUrls(candidatesTried);
      setDebugInfo({ tried: candidatesTried });

      if (!result) {
        setFetchError("No ticket record found on server (checked candidate endpoints). Check network tab for details.");
        setFetchingServerCode(false);
        return;
      }

      // extract ticket_code from response
      const ticket = extractTicketCodeFromResponse(result);
      if (ticket) {
        setLocalTicketCode(ticket);
        setFetchingServerCode(false);
        return;
      }

      // If response contains wrapper with nested data that has ticket_code, try to coerce
      // (handled in extractTicketCodeFromResponse) — if still nothing, show debug body snippet
      setFetchError("Server returned record but no ticket_code found in response.");
      setDebugInfo(prev => ({ ...prev, body: result }));
    } catch (e) {
      console.error("[VisitorTicket] fetchCanonicalTicketCode error:", e && (e.message || e));
      setFetchError(String(e && e.message ? e.message : e));
    } finally {
      setFetchingServerCode(false);
    }
  }, [v, apiBase, providedTicketCode]);

  return (
    <div ref={cardRef} className={`mx-auto max-w-[860px] bg-transparent ${className}`}>
      <div style={{ background: "#eedfbf", borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
        {v.bannerUrl ? (
          <img src={v.bannerUrl} alt="Event banner" style={{ width: "100%", display: "block", borderTopLeftRadius: 8, borderTopRightRadius: 8 }} />
        ) : (
          <div style={{ padding: 18, textAlign: "center", fontWeight: 700, color: "#8b5e34" }}>{v.eventName || "RailTrans Expo 2026"}</div>
        )}
      </div>

      <div style={{ background: "linear-gradient(#e8f8fb, #ffffff)", padding: "28px 28px 0", borderLeft: "1px solid rgba(0,0,0,0.03)", borderRight: "1px solid rgba(0,0,0,0.03)" }}>
        <div style={{
          maxWidth: 520,
          margin: "0 auto",
          background: "#fff",
          borderRadius: 12,
          padding: "34px 28px",
          boxShadow: "0 6px 18px rgba(9,30,66,0.08)",
          border: "1px solid rgba(2,6,23,0.06)",
          textAlign: "center"
        }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#0b1820", marginBottom: 6 }}>{name || " "}</div>
          {company ? <div style={{ fontSize: 18, color: "#111827", marginBottom: 18 }}>{company}</div> : null}

          {showQRCode && qrUrl ? (
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", margin: "12px 0 8px" }}>
              <img src={qrUrl} alt={qrData ? `QR` : "QR"} width={qrSize} height={qrSize} style={{ borderRadius: 8 }} />
            </div>
          ) : null}

          {!qrData && (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: "#ef4444", fontWeight: 700 }}>Ticket code not available</div>
              <div style={{ marginTop: 10, display: "flex", gap: 8, justifyContent: "center" }}>
                <button
                  onClick={fetchCanonicalTicketCode}
                  disabled={fetchingServerCode}
                  style={{
                    padding: "10px 14px",
                    background: "#0b556b",
                    color: "#fff",
                    borderRadius: 8,
                    fontWeight: 700,
                    border: "none",
                    cursor: fetchingServerCode ? "default" : "pointer"
                  }}
                >
                  {fetchingServerCode ? "Fetching…" : "Fetch server ticket code"}
                </button>
                <button
                  onClick={() => { navigator.clipboard && navigator.clipboard.writeText(JSON.stringify(v).slice(0, 2000)); }}
                  style={{
                    padding: "10px 14px",
                    background: "#f3f4f6",
                    color: "#0b556b",
                    borderRadius: 8,
                    border: "1px solid #e6eef4",
                    cursor: "pointer",
                    fontWeight: 700
                  }}
                >
                  Copy payload
                </button>
              </div>
              {fetchError ? <div style={{ marginTop: 8, color: "#b91c1c" }}>{fetchError}</div> : null}
              {debugInfo && debugInfo.tried ? (
                <div style={{ marginTop: 8, color: "#374151", fontSize: 12, textAlign: "left" }}>
                  <div style={{ fontWeight: 700 }}>Tried endpoints (debug):</div>
                  <ul style={{ paddingLeft: 16 }}>
                    {debugInfo.tried.map((u, i) => <li key={i}><code style={{ fontSize: 11 }}>{u}</code></li>)}
                  </ul>
                </div>
              ) : null}
              {debugInfo && debugInfo.body ? (
                <pre style={{ marginTop: 8, fontSize: 11, maxHeight: 200, overflow: "auto", background: "#f8fafc", padding: 8 }}>{JSON.stringify(debugInfo.body, null, 2)}</pre>
              ) : null}
            </div>
          )}
        </div>

        <div style={{ marginTop: 22, display: "flex", justifyContent: "center", gap: 18, alignItems: "center", paddingBottom: 8 }}>
          {v.sponsorLogos && Array.isArray(v.sponsorLogos) && v.sponsorLogos.length ? (
            v.sponsorLogos.slice(0, 3).map((src, i) => (
              <img key={i} src={src} alt={`sponsor-${i}`} style={{ height: 48, objectFit: "contain", borderRadius: 6, background: "#fff", padding: 6, boxShadow: "0 2px 6px rgba(0,0,0,0.04)" }} />
            ))
          ) : (
            <>
              <div style={{ width: 120, height: 48, background: "rgba(255,255,255,0.6)", borderRadius: 8 }} />
              <div style={{ width: 120, height: 48, background: "rgba(255,255,255,0.6)", borderRadius: 8 }} />
              <div style={{ width: 120, height: 48, background: "rgba(255,255,255,0.6)", borderRadius: 8 }} />
            </>
          )}
        </div>
      </div>

      <div style={{ background: accentColor, padding: "26px 0", borderBottomLeftRadius: 8, borderBottomRightRadius: 8 }}>
        <div style={{ textAlign: "center", color: "#ffffff", fontSize: 48, fontWeight: 900, letterSpacing: "0.06em" }}>
          {ticketCategory || "VISITOR"}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "center", gap: 12, marginTop: 12 }}>
        {downloadUrl ? (
          <button onClick={handleDownload} style={{ padding: "12px 20px", background: "#0b556b", color: "#fff", borderRadius: 8, border: "none", fontWeight: 700 }}>Download E‑Badge PDF</button>
        ) : (
          <div style={{ color: "#6b7280", alignSelf: "center" }}>E‑Badge will be emailed</div>
        )}
        <button onClick={handlePrintCard} style={{ padding: "12px 20px", background: "#fff", color: "#0b556b", borderRadius: 8, border: "1px solid rgba(2,6,23,0.08)", fontWeight: 700 }}>Print Card</button>
      </div>
    </div>
  );
}