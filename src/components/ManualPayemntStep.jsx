import React, { useEffect, useRef, useState } from "react";

/**
 * ManualPaymentStep with coupon reservation
 *
 * - Validates coupon and shows reduced price.
 * - When user clicks "Pay Online":
 *    - If coupon applied & not already reserved on server, reserve it by calling
 *      POST /api/coupons/validate { code, price, markUsed: true } (atomic server-side mark)
 *    - If reservation succeeds proceed to create order for reduced amount
 *    - If reservation fails, abort and show error
 * - If payment fails/cancels or polling times out, unreserve coupon:
 *    POST /api/coupons/:id/unuse
 * - If payment succeeds, keep coupon marked used.
 *
 * Backend endpoints required (we added these earlier):
 * - POST /api/coupons/validate
 * - POST /api/coupons/:id/unuse
 * - POST /api/payment/create-order
 * - GET  /api/payment/status?reference_id=...
 *
 * Configure backend base via prop apiBase or REACT_APP_API_BASE / window.__API_BASE__.
 */

export default function ManualPaymentStep({
  ticketType,
  ticketPrice = 0,
  onProofUpload,
  onTxIdChange,
  txId,
  proofFile,
  setProofFile,
  apiBase,
}) {
  const [payLoading, setPayLoading] = useState(false);
  const [error, setError] = useState("");
  const [checkoutOpened, setCheckoutOpened] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState("created");
  const pollRef = useRef(null);

  // coupon states
  const [couponCode, setCouponCode] = useState("");
  const [couponResult, setCouponResult] = useState(null); // { valid, discount, reducedPrice, coupon:{id,code,used}}
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState("");
  const [couponMarkedUsed, setCouponMarkedUsed] = useState(false); // whether server reports used (reserved)
  const [reservedCouponId, setReservedCouponId] = useState(null); // coupon id reserved during payment init

  // compute GST and totals
  const gst = Math.round(ticketPrice * 0.18);
  const originalTotal = Number((ticketPrice + gst).toFixed(2));
  const effectiveTotal = couponResult && couponResult.valid && typeof couponResult.reducedPrice === "number"
    ? Number(couponResult.reducedPrice.toFixed ? couponResult.reducedPrice.toFixed(2) : couponResult.reducedPrice)
    : originalTotal;

  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, []);

  const backendBaseCandidate =
    (apiBase && String(apiBase).trim()) ||
    (typeof process !== "undefined" && process.env && process.env.REACT_APP_API_BASE) ||
    (typeof window !== "undefined" && window.__API_BASE__) ||
    "";

  function likelyProviderHost(h) {
    if (!h) return false;
    const lc = String(h).toLowerCase();
    return lc.includes("instamojo") || lc.includes("razorpay") || lc.includes("paytm") || lc.includes("stripe") || lc.includes("paypal");
  }

  const backendBase = likelyProviderHost(backendBaseCandidate) ? "" : backendBaseCandidate;

  function makeUrl(path) {
    if (!backendBase) return path.startsWith("/") ? path : `/${path}`;
    return `${String(backendBase).replace(/\/$/, "")}${path.startsWith("/") ? path : `/${path}`}`;
  }

  /* ---------- Coupon helpers ---------- */

  // Validate (preview) coupon without marking used
  async function applyCouponPreview() {
    setCouponBusy(true);
    setCouponError("");
    setCouponResult(null);
    try {
      const code = (couponCode || "").trim().toUpperCase();
      if (!code) {
        setCouponError("Enter a coupon code");
        setCouponBusy(false);
        return;
      }
      const payload = { code, price: originalTotal, markUsed: false };
      const res = await fetch(makeUrl("/api/coupons/validate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const js = await res.json().catch(() => null);
      if (!res.ok || !js) {
        const msg = (js && (js.error || js.message)) || `Validate failed (${res.status})`;
        setCouponError(msg);
        setCouponBusy(false);
        return;
      }
      if (!js.valid) {
        setCouponError(js.error || "Invalid coupon");
        setCouponResult(js);
        setCouponBusy(false);
        return;
      }
      // success
      setCouponResult(js);
      setCouponMarkedUsed(!!(js.coupon && js.coupon.used));
      if (js.coupon && js.coupon.id) setReservedCouponId(js.coupon.id); // if server returned coupon used flag, capture id
      setCouponError("");
    } catch (e) {
      console.error("applyCouponPreview error", e);
      setCouponError(String(e && (e.message || e)));
    } finally {
      setCouponBusy(false);
    }
  }

  // Apply & mark used immediately (admin action reserved earlier by user)
  async function applyCouponAndMark() {
    setCouponBusy(true);
    setCouponError("");
    setCouponResult(null);
    try {
      const code = (couponCode || "").trim().toUpperCase();
      if (!code) {
        setCouponError("Enter a coupon code");
        setCouponBusy(false);
        return;
      }
      const payload = { code, price: originalTotal, markUsed: true };
      const res = await fetch(makeUrl("/api/coupons/validate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });
      const js = await res.json().catch(() => null);
      if (!res.ok || !js) {
        const msg = (js && (js.error || js.message)) || `Mark-validate failed (${res.status})`;
        setCouponError(msg);
        setCouponBusy(false);
        return;
      }
      if (!js.valid) {
        setCouponError(js.error || "Invalid coupon");
        setCouponResult(js);
        setCouponBusy(false);
        return;
      }
      // Marked used on server
      setCouponResult(js);
      setCouponMarkedUsed(true);
      if (js.coupon && js.coupon.id) setReservedCouponId(js.coupon.id);
      setCouponError("");
    } catch (e) {
      console.error("applyCouponAndMark error", e);
      setCouponError(String(e && (e.message || e)));
    } finally {
      setCouponBusy(false);
    }
  }

  // Unreserve a reserved coupon (call when payment fails)
  async function unreserveCoupon(id) {
    if (!id) return;
    try {
      await fetch(makeUrl(`/api/coupons/${encodeURIComponent(id)}/unuse`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
    } catch (e) {
      console.warn("unreserveCoupon failed", e);
    }
  }

  // Unapply locally (does not unmark used on server). If coupon was reserved by this client prior to payment and not used, we unreserve on failure.
  function unapplyCouponLocal() {
    setCouponCode("");
    setCouponResult(null);
    setCouponMarkedUsed(false);
    setReservedCouponId(null);
    setCouponError("");
  }

  /* ---------- payment helpers (reserve coupon then create order + poll) ---------- */

  async function createOrder() {
    setError("");
    setPayLoading(true);

    // If coupon is applied and not yet reserved on server, reserve it (markUsed=true)
    let reservedId = reservedCouponId || null;
    try {
      if (couponResult && couponResult.valid && !couponMarkedUsed && !reservedId) {
        // Attempt to reserve atomically
        setCouponBusy(true);
        const code = (couponCode || (couponResult.coupon && couponResult.coupon.code) || "").trim().toUpperCase();
        if (!code) {
          setCouponError("Coupon code missing");
          setPayLoading(false);
          setCouponBusy(false);
          return;
        }
        const payload = { code, price: originalTotal, markUsed: true };
        const r = await fetch(makeUrl("/api/coupons/validate"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          credentials: "include",
        });
        const rjs = await r.json().catch(() => null);
        if (!r.ok || !rjs || !rjs.valid) {
          const msg = (rjs && (rjs.error || rjs.message)) || `Failed to reserve coupon (${r && r.status})`;
          setError(msg);
          setCouponBusy(false);
          setPayLoading(false);
          return;
        }
        // reserved successfully
        setCouponResult(rjs);
        setCouponMarkedUsed(true);
        reservedId = rjs.coupon && rjs.coupon.id ? rjs.coupon.id : reservedId;
        setReservedCouponId(reservedId);
        setCouponBusy(false);
      }

      // If amount becomes zero after coupon, skip checkout and treat as paid
      const amountToPay = Number(effectiveTotal || 0);
      if (!amountToPay || amountToPay <= 0) {
        // mark used already reserved above; if not reserved and couponResult valid we should reserve now
        if (couponResult && couponResult.valid && !couponMarkedUsed && !reservedId) {
          // attempt reserve now
          try {
            const payload = { code: couponCode.trim().toUpperCase(), price: originalTotal, markUsed: true };
            const r = await fetch(makeUrl("/api/coupons/validate"), {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
              credentials: "include",
            });
            const rjs = await r.json().catch(()=>null);
            if (r.ok && rjs && rjs.valid) {
              setCouponMarkedUsed(true);
              reservedId = rjs.coupon && rjs.coupon.id ? rjs.coupon.id : reservedId;
              setReservedCouponId(reservedId);
            } else {
              // failed to reserve — abort
              setError((rjs && (rjs.error || rjs.message)) || "Failed to reserve coupon for zero-amount");
              setPayLoading(false);
              return;
            }
          } catch (e) {
            setError("Failed to reserve coupon");
            setPayLoading(false);
            return;
          }
        }
        // treat as successful payment (no provider)
        setPaymentStatus("paid");
        try { onTxIdChange && onTxIdChange(`free-${Date.now()}`); } catch (_) {}
        try { onProofUpload && onProofUpload(); } catch (_) {}
        setPayLoading(false);
        return;
      }

      // proceed to create payment order with backend
      const verifiedEmail =
        (typeof window !== "undefined" && (localStorage.getItem("verifiedEmail") || sessionStorage.getItem("verifiedEmail"))) || "";
      const referenceId = (verifiedEmail && verifiedEmail.trim()) || `guest-${Date.now()}`;

      const payload = {
        amount: amountToPay,
        currency: "INR",
        description: `Ticket - ${ticketType || "General"}`,
        reference_id: referenceId,
        metadata: {
          ticketType,
          referenceId,
          couponCode: couponResult && couponResult.coupon ? couponResult.coupon.code : couponCode.trim().toUpperCase(),
          buyer_name: (typeof window !== "undefined" && localStorage.getItem("visitorName")) || "",
          email: (verifiedEmail && verifiedEmail.trim()) || "",
        },
      };

      const endpoint = makeUrl("/api/payment/create-order");
      console.log("[ManualPaymentStep] createOrder ->", endpoint, "payload:", payload);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      let data = null;
      let rawText = null;
      try {
        rawText = await res.text();
        try { data = JSON.parse(rawText); } catch { data = null; }
      } catch (e) {
        rawText = null;
        data = null;
      }
      console.log("[ManualPaymentStep] create-order response:", res.status, data || rawText);

      if (!res.ok || !data || !data.success) {
        // on failure to create order, if we reserved coupon above, unreserve it
        if (reservedId) {
          await unreserveCoupon(reservedId);
          setReservedCouponId(null);
          setCouponMarkedUsed(false);
        }
        const providerHint = backendBaseCandidate && likelyProviderHost(backendBaseCandidate)
          ? "It looks like your frontend is configured to call the payment provider directly. Make sure REACT_APP_API_BASE / window.__API_BASE__ point to your backend (not the provider)."
          : null;
        const errMsg =
          (data && (data.error || data.provider_error || data.details || JSON.stringify(data))) ||
          (rawText && rawText.slice(0, 200)) ||
          `Failed to create payment order (status ${res.status})` +
          (providerHint ? " - " + providerHint : "");
        setError(errMsg);
        setPayLoading(false);
        return;
      }

      const checkoutUrl = data.checkoutUrl || data.longurl || data.raw?.payment_request?.longurl || data.raw?.longurl;
      if (!checkoutUrl) {
        // unreserve if needed
        if (reservedId) {
          await unreserveCoupon(reservedId);
          setReservedCouponId(null);
          setCouponMarkedUsed(false);
        }
        setError("Payment provider did not return a checkout URL.");
        setPayLoading(false);
        return;
      }

      // open checkout
      const w = window.open(checkoutUrl, "_blank", "noopener,noreferrer");
      if (!w) {
        if (reservedId) {
          await unreserveCoupon(reservedId);
          setReservedCouponId(null);
          setCouponMarkedUsed(false);
        }
        setError("Could not open payment window. Please allow popups.");
        setPayLoading(false);
        return;
      }

      setCheckoutOpened(true);
      setPaymentStatus("pending");

      // start polling payment status
      const reference_id = payload.reference_id;
      let attempts = 0;
      pollRef.current = setInterval(async () => {
        attempts += 1;
        try {
          const statusUrl = makeUrl(`/api/payment/status?reference_id=${encodeURIComponent(reference_id)}`);
          const st = await fetch(statusUrl, { method: "GET", credentials: "include" });
          if (!st.ok) {
            console.warn("[ManualPaymentStep] status fetch not ok:", st.status);
            return;
          }
          const js = await st.json().catch(() => null);
          if (!js) return;
          const status = (js.status || "").toString().toLowerCase();
          if (["paid", "captured", "completed", "success"].includes(status)) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setPaymentStatus("paid");
            const rec = js.record || js.data || js.payment || js;
            const providerPaymentId = rec?.provider_payment_id || rec?.payment_id || rec?.id || null;
            const finalTx = providerPaymentId || `provider-${Date.now()}`;
            try { onTxIdChange && onTxIdChange(finalTx); } catch (_) {}
            try { if (w && !w.closed) w.close(); } catch (_) {}
            onProofUpload && onProofUpload();
            // coupon remains marked used (reserved)
          } else if (["failed", "cancelled", "void"].includes(status)) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setPaymentStatus("failed");
            setError("Payment failed or cancelled. You may retry.");
            try { if (w && !w.closed) w.close(); } catch (_) {}
            // if we reserved coupon earlier, unreserve now
            if (reservedId) {
              await unreserveCoupon(reservedId);
              setReservedCouponId(null);
              setCouponMarkedUsed(false);
            }
          } else {
            if (attempts > 40) {
              clearInterval(pollRef.current);
              pollRef.current = null;
              setPaymentStatus("pending");
              setError("Payment not confirmed yet. If you completed payment, wait a bit and refresh the page.");
              // unreserve coupon to avoid wasting it if you want (optional). We'll unreserve to be safe.
              if (reservedId) {
                await unreserveCoupon(reservedId);
                setReservedCouponId(null);
                setCouponMarkedUsed(false);
              }
            }
          }
        } catch (e) {
          console.warn("[ManualPaymentStep] polling error:", e && e.message);
        }
      }, 3000);
    } catch (err) {
      console.error("[ManualPaymentStep] createOrder error:", err && (err.stack || err));
      // if we reserved coupon earlier, unreserve
      if (reservedCouponId) {
        await unreserveCoupon(reservedCouponId);
        setReservedCouponId(null);
        setCouponMarkedUsed(false);
      }
      setError(err.message || "Payment initiation failed");
    } finally {
      setPayLoading(false);
    }
  }

  return (
    <div className="bg-white rounded-xl shadow-xl p-8 max-w-lg mx-auto mt-8">
      <div className="text-xl font-bold mb-2">
        Payment — {ticketType ? `${ticketType.charAt(0).toUpperCase() + ticketType.slice(1)} Ticket` : "Ticket"}
      </div>

      <div className="mb-4">
        <div className="text-sm text-gray-600">Base Price</div>
        <div className="text-2xl font-semibold text-[#196e87]">₹{ticketPrice}</div>
        <div className="text-xs text-gray-500">GST (18%): ₹{gst} — Original Total: ₹{originalTotal}</div>
      </div>

      {/* Coupon area */}
      <div className="mb-4 p-3 border rounded bg-gray-50">
        <div className="font-semibold mb-2">Have a coupon?</div>

        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs text-gray-600">Coupon code</label>
            <input value={couponCode} onChange={(e) => setCouponCode(e.target.value)} placeholder="Enter coupon code" className="w-full border rounded px-2 py-1" />
          </div>

          <div className="flex flex-col gap-2">
            <button
              className="px-3 py-1 bg-blue-600 text-white rounded"
              onClick={() => applyCouponPreview()}
              disabled={couponBusy}
              type="button"
            >
              {couponBusy ? "Checking..." : "Apply"}
            </button>
            <button
              className="px-3 py-1 bg-green-600 text-white rounded"
              onClick={() => applyCouponAndMark()}
              disabled={couponBusy}
              type="button"
            >
              {couponBusy ? "Applying..." : "Apply & Mark Used"}
            </button>
          </div>
        </div>

        {couponError && <div className="mt-2 text-red-600 text-sm">{couponError}</div>}

        {couponResult && (
          <div className="mt-3 text-sm text-gray-700 p-2 bg-white border rounded">
            {couponResult.valid ? (
              <>
                <div className="font-medium text-green-700">Coupon applied: {couponResult.coupon?.code || couponCode}</div>
                <div>Discount: {couponResult.discount}%</div>
                <div>Reduced total: <span className="font-semibold">₹{Number(couponResult.reducedPrice).toFixed(2)}</span></div>
                <div className="mt-2 flex gap-2">
                  {!couponMarkedUsed && (
                    <button className="px-3 py-1 border rounded" onClick={() => applyCouponAndMark()}>Mark Used Now</button>
                  )}
                  <button className="px-3 py-1 border rounded" onClick={unapplyCouponLocal} disabled={couponMarkedUsed}>Remove</button>
                </div>
                {couponMarkedUsed && <div className="mt-2 text-sm text-red-600">Coupon has been marked used and cannot be reused.</div>}
              </>
            ) : (
              <>
                <div className="font-medium text-red-600">Coupon invalid or not applicable</div>
                {couponResult.error && <div className="text-xs text-gray-600 mt-1">{couponResult.error}</div>}
              </>
            )}
          </div>
        )}
      </div>

      <div className="mb-6">
        <div className="font-semibold mb-2">Pay Online</div>
        <div className="text-sm text-gray-700 mb-3">Secure checkout via your payment provider.</div>

        <div className="mb-3">
          <div className="text-sm text-gray-600">Amount to pay</div>
          <div className="text-2xl font-semibold text-[#196e87]">₹{Number(effectiveTotal).toFixed(2)}</div>
          {effectiveTotal !== originalTotal && (
            <div className="text-xs text-gray-500">Original: ₹{originalTotal} — You saved ₹{(originalTotal - effectiveTotal).toFixed(2)}</div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            className="px-4 py-2 bg-green-600 text-white rounded disabled:opacity-60"
            onClick={createOrder}
            disabled={payLoading || checkoutOpened}
          >
            {payLoading ? "Opening checkout..." : checkoutOpened ? "Checkout opened" : "Pay Online"}
          </button>
        </div>

        {paymentStatus === "pending" && <div className="mt-2 text-sm text-yellow-600">Waiting for provider confirmation...</div>}
        {paymentStatus === "paid" && <div className="mt-2 text-sm text-green-600">Payment confirmed.</div>}
      </div>

      <hr className="my-4" />

      {error && <div className="mt-4 text-red-600 font-medium whitespace-pre-wrap">{error}</div>}
      <div className="mt-4 text-xs text-gray-500">
        If you pay online, the checkout will open in a new tab. After successful payment we will automatically continue the registration.
      </div>
    </div>
  );
}