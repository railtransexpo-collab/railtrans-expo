import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ThankYouMessage from "../components/ThankYouMessage";

/**
 * AddRegistrantModal (ADMIN ONLY)
 *
 * Responsibilities:
 * - Create record AND send appropriate ticket email (Visitor/Delegate based on ticket category)
 * - Before create: when email is entered, check whether same email already exists
 *   in the same registration collection (uses /api/otp/check-email).
 */

export default function AddRegistrantModal({
  open,
  onClose,
  onCreated,
  defaultRole = "visitor",
  apiBase = "",
}) {
  const ROLE_OPTIONS = ["visitor", "exhibitor", "partner", "speaker", "awardee"];
  const navigate = useNavigate();

  const [step, setStep] = useState("selectRole"); // selectRole | selectCategory | form | done
  const [role, setRole] = useState(defaultRole);
  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketMeta, setTicketMeta] = useState({
    price: 0,
    gstAmount: 0,
    total: 0,
    label: "",
  });
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");
  const [sendingEmail, setSendingEmail] = useState(false);

  // Email existence check state
  const [existing, setExisting] = useState(null);
  const [checkingEmail, setCheckingEmail] = useState(false);
  const checkTimerRef = useRef(null);

  function apiUrl(path) {
    const base = (apiBase || (typeof window !== "undefined" && window.__API_BASE__) || "").replace(/\/$/, "");
    return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
  }

  function reset() {
    setStep("selectRole");
    setRole(defaultRole);
    setTicketCategory("");
    setTicketMeta({ price: 0, gstAmount: 0, total: 0, label: "" });
    setFields([]);
    setValues({});
    setMsg("");
    setLoading(false);
    setSendingEmail(false);
    setExisting(null);
    setCheckingEmail(false);
    if (checkTimerRef.current) {
      clearTimeout(checkTimerRef.current);
      checkTimerRef.current = null;
    }
  }

  useEffect(() => {
    if (open) reset();
  }, [open]);

  /* ---------------- helpers ---------------- */

  function normalizeConfigFields(cols = []) {
    if (!Array.isArray(cols)) return [];
    return cols.map((c) => {
      const name = c.name || c.key || c.field || c.id;
      const type = (c.type || (c.options ? "select" : "text") || "text").toLowerCase();
      const options = c.options || c.choices || c.values || c.items || [];
      return {
        name,
        label: c.label || c.title || c.name || c.key || name,
        type,
        options,
        required: !!c.required,
      };
    });
  }

  function makeInitialValues(normalizedFields = []) {
    const init = {};
    normalizedFields.forEach((f) => {
      if (f.type === "checkbox") init[f.name] = false;
      else init[f.name] = "";
    });
    if (ticketCategory) init.ticket_category = ticketCategory;
    return init;
  }

  function ensurePluralRole(r) {
    if (!r) return "visitors";
    return r.endsWith("s") ? r : `${r}s`;
  }

  function normalizeEmail(e = "") {
    return String(e || "").trim().toLowerCase();
  }

  /* ---------------- config load ---------------- */

  async function loadConfig(selectedRole) {
    setLoading(true);
    setMsg("");
    try {
      const res = await fetch(apiUrl(`/api/registration-configs/${selectedRole}`));
      const js = await res.json().catch(() => null);
      const cols = js?.config?.fields || js?.fields || [];
      const normalized = normalizeConfigFields(cols);

      // If no normalized fields returned, provide sensible defaults for visitor
      if (normalized.length === 0) {
        if (selectedRole === "visitor") {
          normalized.push(
            { name: "name", label: "Name", type: "text", required: true, options: [] },
            { name: "email", label: "Email", type: "text", required: true, options: [] },
            { name: "mobile", label: "Mobile", type: "text", required: false, options: [] }
          );
        }
      }

      const init = makeInitialValues(normalized);
      setFields(normalized);
      setValues(init);
      setStep("form");
    } catch (e) {
      console.warn("loadConfig error", e);
      setMsg("Failed to load form");
    } finally {
      setLoading(false);
    }
  }

  /* ---------------- change handlers ---------------- */

  function updateValue(name, val, type) {
    setValues((s) => {
      const next = { ...s };
      if (type === "number") {
        next[name] = val === "" ? "" : Number(val);
      } else if (type === "checkbox") {
        next[name] = !!val;
      } else {
        next[name] = val;
      }
      return next;
    });
  }

  /* ---------------- email existence check (debounced) ---------------- */

  useEffect(() => {
    // Only run when on form step and email field exists
    if (step !== "form") return;
    const emailRaw = values.email || values.emailAddress || "";
    const email = normalizeEmail(emailRaw);
    if (!email) {
      setExisting(null);
      setMsg("");
      setCheckingEmail(false);
      return;
    }

    // debounce
    if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    checkTimerRef.current = setTimeout(async () => {
      try {
        setCheckingEmail(true);
        setExisting(null);
        setMsg("");
        const url = apiUrl(`/api/otp/check-email?email=${encodeURIComponent(email)}&type=${encodeURIComponent(role)}`);
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        const data = await res.json().catch(() => null);
        if (res.ok && data && data.success && data.found) {
          const info = data.info || null;
          const ourCollection = ensurePluralRole(role);
          const conflict = info && String(info.collection) === ourCollection;
          setExisting(info || null);
          if (conflict) {
            setMsg("This email already exists in the same registration table. Use Upgrade Ticket instead of creating a duplicate record.");
          } else if (info) {
            setMsg(`Email found in another collection (${info.collection}). You may still create a separate record here.`);
          } else {
            setMsg("");
          }
        } else {
          setExisting(null);
          setMsg("");
        }
      } catch (e) {
        console.warn("check-email error", e);
        setExisting(null);
        setMsg("");
      } finally {
        setCheckingEmail(false);
      }
    }, 350);

    return () => {
      if (checkTimerRef.current) clearTimeout(checkTimerRef.current);
    };
    
  }, [values.email, values.emailAddress, role, step]);

  /* ---------------- NEW: Send ticket email based on category ---------------- */
  async function sendTicketEmail(registrantData, isPaidTicket) {
    try {
      const emailType = isPaidTicket ? "delegate_ticket" : "visitor_ticket";
      const emailPayload = {
        to: registrantData.email,
        subject: isPaidTicket ? "Your Delegate Ticket - RailTrans Expo" : "Your Visitor Registration - RailTrans Expo",
        registrantData: {
          name: registrantData.name,
          email: registrantData.email,
          mobile: registrantData.mobile,
          ticket_category: registrantData.ticket_category,
          ticket_label: registrantData.ticket_label,
          ticket_price: registrantData.ticket_price,
          ticket_total: registrantData.ticket_total,
          registration_id: registrantData.id,
          role: role,
        },
        emailType: emailType,
      };

      const response = await fetch(apiUrl("/api/send-ticket-email"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(emailPayload),
      });

      const result = await response.json();
      if (response.ok && result.success) {
        console.log(`${emailType} email sent successfully to ${registrantData.email}`);
        return true;
      } else {
        console.error("Failed to send ticket email:", result.error);
        return false;
      }
    } catch (error) {
      console.error("Error sending ticket email:", error);
      return false;
    }
  }

  /* ---------------- submit with email sending ---------------- */
  async function handleCreate(e) {
    e.preventDefault();
    setLoading(true);
    setMsg("");

    try {
      // Re-check before creating to avoid race
      const emailRaw = values.email || values.emailAddress || "";
      const email = normalizeEmail(emailRaw);
      if (email) {
        try {
          const url = apiUrl(`/api/otp/check-email?email=${encodeURIComponent(email)}&type=${encodeURIComponent(role)}`);
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          const data = await res.json().catch(() => null);
          if (res.ok && data && data.success && data.found) {
            const info = data.info || null;
            const ourCollection = ensurePluralRole(role);
            if (info && String(info.collection) === ourCollection) {
              setExisting(info);
              setMsg("Email already exists in this collection — create aborted. Use Upgrade Ticket.");
              setLoading(false);
              return;
            }
          }
        } catch (e) {
          // ignore and proceed to create (best-effort)
        }
      }

      const collection = `${role}s`;
      
      // Determine if this is a paid ticket (delegate) or free ticket (visitor)
      const isPaidTicket = ticketMeta.total > 0 && !/free|general|0/i.test(String(ticketCategory || ""));
      
      const payload = {
        ...values,
        ticket_category: ticketCategory || null,
        ticket_label: ticketMeta.label || null,
        ticket_price: ticketMeta.price || 0,
        ticket_gst: ticketMeta.gstAmount || 0,
        ticket_total: ticketMeta.total || 0,
        added_by_admin: true,
        admin_created_at: new Date().toISOString(),
        skipOtp: true,
        // Mark if email should be sent
        send_email: true,
        email_type: isPaidTicket ? "delegate" : "visitor",
      };

      const res = await fetch(apiUrl(`/api/${collection}`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const js = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg(js?.error || "Create failed");
        setLoading(false);
        return;
      }

      // Get the created registrant ID
      const registrantId = js.id || js.insertedId || js._id;
      
      // Prepare registrant data for email
      const registrantData = {
        id: registrantId,
        name: values.name || "",
        email: email,
        mobile: values.mobile || "",
        ticket_category: ticketCategory,
        ticket_label: ticketMeta.label,
        ticket_price: ticketMeta.price,
        ticket_total: ticketMeta.total,
      };

      // Send appropriate ticket email
      setSendingEmail(true);
      const emailSent = await sendTicketEmail(registrantData, isPaidTicket);
      
      if (emailSent) {
        setMsg(isPaidTicket ? "Registrant created and Delegate ticket sent!" : "Registrant created and Visitor ticket sent!");
      } else {
        setMsg("Registrant created but email sending failed. Please resend manually.");
      }

      onCreated && onCreated(js, collection);
      setStep("done");

      setTimeout(() => {
        onClose();
      }, 1500);
    } catch (err) {
      console.error("AddRegistrantModal create error", err);
      setMsg("Error creating record");
    } finally {
      setLoading(false);
      setSendingEmail(false);
    }
  }

  function handleUpgradeNavigate() {
    if (!existing) return;
    const collection = existing.collection || ensurePluralRole(existing.role || role);
    const id = existing.id || existing._id || (existing._id && existing._id.$oid) || null;
    const ticket = existing.ticket_code || existing.ticketCode || null;
    const emailParam = encodeURIComponent(normalizeEmail(values.email || values.emailAddress || ""));

    if (id) {
      navigate(`/ticket-upgrade?entity=${encodeURIComponent(collection)}&id=${encodeURIComponent(String(id))}&email=${emailParam}`);
      return;
    }
    if (ticket) {
      navigate(`/ticket-upgrade?entity=${encodeURIComponent(collection)}&ticket_code=${encodeURIComponent(String(ticket))}&email=${emailParam}`);
      return;
    }
    navigate(`/ticket-upgrade?entity=${encodeURIComponent(collection)}&email=${emailParam}`);
  }

  // Handle ticket selection with meta data
  const handleTicketSelect = (value, meta = {}) => {
    setTicketCategory(value);
    setTicketMeta(meta || { price: 0, gstAmount: 0, total: 0, label: "" });
  };

  /* ---------------- UI ---------------- */

  if (!open) return null;

  const createDisabled = checkingEmail || (existing && String(existing.collection) === ensurePluralRole(role));

  return (
    <div className="fixed inset-0 z-50 flex justify-center items-start p-6">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        className="relative bg-white w-full max-w-xl rounded shadow-lg"
        style={{ maxHeight: "80vh", width: "100%", overflow: "hidden" }}
      >
        <div className="p-4 border-b">
          <h3 className="text-lg font-semibold">Add Registrant (Admin)</h3>
          <p className="text-sm text-gray-500 mt-1">
            {ticketMeta.total > 0 ? "Will send DELEGATE ticket" : "Will send VISITOR ticket"}
          </p>
        </div>

        <div
          className="p-4 overflow-y-auto"
          style={{ maxHeight: "calc(80vh - 140px)" }}
        >
          {step === "selectRole" && (
            <>
              <label className="block mb-2">Select Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full border px-2 py-1 mb-4"
              >
                {ROLE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>

              <div className="flex gap-2">
                <button
                  className="px-4 py-2 bg-blue-600 text-white rounded"
                  onClick={() =>
                    role === "visitor" ? setStep("selectCategory") : loadConfig(role)
                  }
                >
                  Continue
                </button>
              </div>
            </>
          )}

          {step === "selectCategory" && (
            <>
              <TicketCategorySelector
                role={role}
                value={ticketCategory}
                onChange={handleTicketSelect}
              />
              {ticketMeta.total > 0 && (
                <div className="mt-3 p-3 bg-blue-50 rounded border border-blue-200">
                  <p className="text-sm text-blue-800">
                    <strong>Note:</strong> This is a paid ticket. The registrant will receive a <strong>DELEGATE ticket</strong> email.
                  </p>
                  <p className="text-sm text-blue-600 mt-1">
                    Amount: ₹{ticketMeta.total}
                  </p>
                </div>
              )}
              {ticketMeta.total === 0 && ticketCategory && (
                <div className="mt-3 p-3 bg-green-50 rounded border border-green-200">
                  <p className="text-sm text-green-800">
                    <strong>Note:</strong> This is a free ticket. The registrant will receive a <strong>VISITOR ticket</strong> email.
                  </p>
                </div>
              )}
              <div className="mt-4 flex gap-2">
                <button
                  className="px-4 py-2 bg-blue-600 text-white rounded"
                  onClick={() => loadConfig(role)}
                >
                  Continue
                </button>
                <button
                  className="px-4 py-2 border rounded"
                  onClick={() => {
                    setStep("selectRole");
                    setTicketCategory("");
                    setTicketMeta({ price: 0, gstAmount: 0, total: 0, label: "" });
                  }}
                >
                  Back
                </button>
              </div>
            </>
          )}

          {step === "form" && (
            <form onSubmit={handleCreate} className="space-y-3">
              {fields.map((f) => {
                const val = values[f.name];
                const required = !!f.required;
                const key = f.name;

                const options = Array.isArray(f.options)
                  ? f.options.map((o) => (typeof o === "object" ? { value: (o.value ?? o), label: (o.label ?? (o.value ?? String(o))) } : { value: o, label: String(o) }))
                  : [];

                if (f.type === "select") {
                  return (
                    <div key={key}>
                      <label className="block mb-1">
                        {f.label} {required && "*"}
                      </label>
                      <select
                        className="w-full border px-3 py-2"
                        value={val ?? ""}
                        onChange={(e) => updateValue(key, e.target.value, "text")}
                        required={required}
                      >
                        <option value="">{required ? "Select" : "None"}</option>
                        {options.map((o, idx) => (
                          <option key={idx} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  );
                }

                if (f.type === "radio") {
                  return (
                    <div key={key}>
                      <label className="block mb-1">
                        {f.label} {required && "*"}
                      </label>
                      <div className="flex gap-4">
                        {options.map((o, idx) => (
                          <label key={idx} className="flex items-center gap-2">
                            <input
                              type="radio"
                              name={key}
                              value={o.value}
                              checked={String(val) === String(o.value)}
                              onChange={(e) => updateValue(key, e.target.value, "text")}
                              required={required}
                            />
                            <span>{o.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                }

                if (f.type === "checkbox") {
                  return (
                    <label key={key} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!!val}
                        onChange={(e) => updateValue(key, e.target.checked, "checkbox")}
                      />
                      <span>
                        {f.label} {required && "*"}
                      </span>
                    </label>
                  );
                }

                if (f.type === "textarea") {
                  return (
                    <div key={key}>
                      <label className="block mb-1">
                        {f.label} {required && "*"}
                      </label>
                      <textarea
                        className="w-full border px-3 py-2"
                        value={val ?? ""}
                        onChange={(e) => updateValue(key, e.target.value, "text")}
                        required={required}
                      />
                    </div>
                  );
                }

                const inputType = ["number", "email", "tel"].includes(f.type) ? f.type : "text";
                return (
                  <div key={key}>
                    <label className="block mb-1">
                      {f.label} {required && "*"}
                    </label>
                    <input
                      className="w-full border px-3 py-2"
                      value={val ?? ""}
                      onChange={(e) => {
                        updateValue(key, e.target.value, f.type);
                        if (key === "email" || key.toLowerCase().includes("email")) {
                          setExisting(null);
                          setMsg("");
                        }
                      }}
                      required={required}
                      type={inputType}
                    />

                    {(key === "email" || key.toLowerCase().includes("email")) && (
                      <>
                        {checkingEmail && <div className="text-xs text-gray-600 mt-1">Checking email...</div>}
                        {existing && msg && (
                          <div className="text-xs mt-1 p-2 bg-yellow-50 border border-yellow-100 rounded text-[#b45309]">
                            <div>{msg}</div>
                            <div className="mt-2">
                              <button
                                type="button"
                                onClick={handleUpgradeNavigate}
                                className="px-2 py-1 bg-white border rounded text-[#21809b] text-xs"
                              >
                                Upgrade Ticket
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                );
              })}

              {/* Display ticket type info in form */}
              <div className="mt-2 p-3 bg-gray-50 rounded border">
                <p className="text-sm">
                  <strong>Ticket Type:</strong>{' '}
                  {ticketMeta.total > 0 ? (
                    <span className="text-blue-600 font-semibold">DELEGATE (Paid - ₹{ticketMeta.total})</span>
                  ) : (
                    <span className="text-green-600 font-semibold">VISITOR (Free)</span>
                  )}
                </p>
              </div>

              <div className="flex gap-3 items-center mt-4">
                <button
                  type="submit"
                  disabled={loading || createDisabled || sendingEmail}
                  className={`px-4 py-2 bg-green-600 text-white rounded ${(createDisabled || sendingEmail) ? "opacity-60 cursor-not-allowed" : ""}`}
                >
                  {loading ? "Creating..." : sendingEmail ? "Sending Email..." : "Create & Send Ticket"}
                </button>
                <button
                  type="button"
                  className="px-4 py-2 border rounded"
                  onClick={() => {
                    setStep("selectRole");
                    setTicketCategory("");
                    setTicketMeta({ price: 0, gstAmount: 0, total: 0, label: "" });
                  }}
                >
                  Cancel
                </button>
                <span className="text-sm text-gray-600">{msg}</span>
              </div>
            </form>
          )}

          {step === "done" && (
            <ThankYouMessage messageOverride="Registrant created successfully! Ticket email has been sent." />
          )}
        </div>
      </div>
    </div>
  );
}