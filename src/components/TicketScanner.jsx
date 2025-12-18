import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

function tryParseJsonSafe(str) { try { return JSON.parse(str); } catch { return null; } }
function looksLikeBase64(s) { return typeof s === "string" && /^[A-Za-z0-9+/=]+$/.test(s.replace(/\s+/g,"")) && s.length % 4 === 0; }

function extractTicketIdFromObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const keys = ["ticket_code","ticketCode","ticket_id","ticketId","ticket","code","c","id","t","tk"];
  for (const k of keys) if (Object.prototype.hasOwnProperty.call(obj, k)) { const v = obj[k]; if (v != null && String(v).trim()) return String(v).trim(); }
  return null;
}

function tryParseTicketId(input) {
  if (input == null) return null;
  if (typeof input === "number") return String(input);
  if (typeof input === "string") {
    const s = input.trim();
    if (!s) return null;
    const parsed = tryParseJsonSafe(s);
    if (parsed && typeof parsed === "object") { const f = extractTicketIdFromObject(parsed); if(f) return f; }
    if (looksLikeBase64(s)) {
      try {
        const dec = atob(s);
        const p2 = tryParseJsonSafe(dec);
        if (p2 && typeof p2 === "object") { const f2 = extractTicketIdFromObject(p2); if(f2) return f2; }
        const tok = dec.match(/[A-Za-z0-9\-_.]{3,64}/); if(tok) return tok[0];
        const dig = dec.match(/\d{3,12}/); if(dig) return dig[0];
      } catch {}
    }
    const token = s.match(/[A-Za-z0-9\-_.]{3,64}/); if(token) return token[0];
    const digits = s.match(/\d{3,12}/); if(digits) return digits[0];
    return null;
  }
  if (typeof input === "object") return extractTicketIdFromObject(input);
  return null;
}

export default function TicketScanner({ apiBase }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const rafRef = useRef(null);

  const [busy, setBusy] = useState(false);
  const [ticketId, setTicketId] = useState(null);
  const [validation, setValidation] = useState(null);
  const [message, setMessage] = useState("Scanning for QR…");

  useEffect(() => {
    let mounted = true;
    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video:{ facingMode:"environment" }, audio:false });
        if (!mounted) { stream.getTracks().forEach(t=>t.stop()); return; }
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        const tick = () => {
          if (!mounted) return;
          if(videoRef.current && videoRef.current.readyState===videoRef.current.HAVE_ENOUGH_DATA) {
            canvas.width = videoRef.current.videoWidth;
            canvas.height = videoRef.current.videoHeight;
            ctx.drawImage(videoRef.current,0,0,canvas.width,canvas.height);
            const img = ctx.getImageData(0,0,canvas.width,canvas.height);
            const code = jsQR(img.data,img.width,img.height,{inversionAttempts:"attemptBoth"});
            if(code && !busy) handleScan(code.data);
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch(e) { console.error(e); setMessage("Camera error"); }
    }
    startCamera();
    return () => { mounted=false; if(rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [busy]);

  async function handleScan(data) {
    setBusy(true);
    const extracted = tryParseTicketId(data);
    if(!extracted) { setValidation({ok:false,error:"No ticket id"}); setMessage("Invalid QR"); setBusy(false); return; }
    setTicketId(extracted);
    setMessage(`Validating: ${extracted}...`);

    try {
      const res = await fetch(`${apiBase}/api/tickets/validate`, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ ticketId: extracted })
      });
      const js = await res.json();
      if(!res.ok || !js.success) { setValidation({ok:false,error:js.error||"Not found"}); setMessage("Ticket not matched"); }
      else { setValidation({ok:true,ticket:js.ticket}); setMessage("Ticket matched ✔"); }
    } catch(e) { console.error(e); setValidation({ok:false,error:e.message}); setMessage("Validation error"); }
    finally { setBusy(false); }
  }

  return (
    <div>
      <video ref={videoRef} style={{width:"100%",maxHeight:480,borderRadius:8}} playsInline muted />
      <canvas ref={canvasRef} style={{display:"none"}} />
      <div>{message}</div>
      {validation && (
        <div style={{marginTop:10, padding:10, border: validation.ok?"1px solid green":"1px solid red"}}>
          {validation.ok ? (
            <div>
              <strong>Matched</strong><br/>
              {validation.ticket.name} — {validation.ticket.company} — {validation.ticket.category}
            </div>
          ) : (<div><strong>Not matched</strong><br/>{validation.error}</div>)}
        </div>
      )}
    </div>
  );
}
