import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

const API_BASE =
  process.env.REACT_APP_API_BASE ||
  window.__API_BASE__ ||
  window.location.origin;

export default function TicketScanner() {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const scanningRef = useRef(false);

  const [message, setMessage] = useState("Scanning QR…");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let active = true;

    async function start() {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" }
      });
      videoRef.current.srcObject = stream;
      await videoRef.current.play();

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d");

      const tick = () => {
        if (!active || scanningRef.current) return;

        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        ctx.drawImage(videoRef.current, 0, 0);

        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const code = jsQR(img.data, img.width, img.height);

        if (code) validate(code.data);
        requestAnimationFrame(tick);
      };

      tick();
    }

    start();
    return () => { active = false; };
  }, []);

  async function validate(raw) {
    scanningRef.current = true;
    setMessage("Validating ticket…");

    try {
      const res = await fetch(`${API_BASE}/api/tickets/validate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketId: raw })
      });

      const text = await res.text();
      const json = text ? JSON.parse(text) : null;

      if (!res.ok || !json?.success) {
        setMessage("❌ Ticket not matched");
        setResult(null);
      } else {
        setMessage("✅ Ticket matched");
        setResult(json.ticket);
      }
    } catch (e) {
      console.error(e);
      setMessage("Server error");
    }
  }

  return (
    <div>
      <video ref={videoRef} style={{ width: "100%" }} />
      <canvas ref={canvasRef} style={{ display: "none" }} />
      <h3>{message}</h3>

      {result && (
        <div>
          <b>{result.name}</b><br />
          {result.company}<br />
          {result.category}
        </div>
      )}
    </div>
  );
}
