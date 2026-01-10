import React, { useEffect, useRef, useState } from "react";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ThankYouMessage from "../components/ThankYouMessage";

/**
 * AddRegistrantModal (ADMIN ONLY)
 *
 * RESPONSIBILITY:
 * - Create record ONLY
 * - NO EMAIL
 * - NO TEMPLATE
 * - NO RESEND
 *
 * Email is sent later via Dashboard → Send Ticket button
 */

export default function AddRegistrantModal({
  open,
  onClose,
  onCreated,
  defaultRole = "visitor",
  apiBase = "",
}) {
  const ROLE_OPTIONS = ["visitor", "exhibitor", "partner", "speaker", "awardee"];

  const [step, setStep] = useState("selectRole"); // selectRole | selectCategory | form | done
  const [role, setRole] = useState(defaultRole);
  const [ticketCategory, setTicketCategory] = useState("");
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  /* ---------------- helpers ---------------- */

  function apiUrl(path) {
    const base = (apiBase || window.__API_BASE__ || "").replace(/\/$/, "");
    return path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
  }

  function reset() {
    setStep("selectRole");
    setRole(defaultRole);
    setTicketCategory("");
    setFields([]);
    setValues({});
    setMsg("");
  }

  useEffect(() => {
    if (open) reset();
  }, [open]);

  /* ---------------- config ---------------- */

  async function loadConfig(selectedRole) {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/registration-configs/${selectedRole}`));
      const js = await res.json().catch(() => null);

      const cols = js?.config?.fields || js?.fields || [];
      const normalized = cols.map((c) => ({
        name: c.name || c.key,
        label: c.label || c.name,
        type: c.type || "text",
        required: !!c.required,
        options: c.options || [],
      }));

      const init = {};
      normalized.forEach((f) => (init[f.name] = ""));
      if (ticketCategory) init.ticket_category = ticketCategory;

      setFields(normalized);
      setValues(init);
      setStep("form");
    } catch (e) {
      setMsg("Failed to load form");
    } finally {
      setLoading(false);
    }
  }

  /* ---------------- submit ---------------- */

  async function handleCreate(e) {
    e.preventDefault();
    setLoading(true);
    setMsg("");

    try {
      const collection = `${role}s`;
      const payload = {
        ...values,
        ticket_category: ticketCategory || null,
        added_by_admin: true,
        admin_created_at: new Date().toISOString(),
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

      onCreated && onCreated(js, collection);
      setStep("done");

      setTimeout(() => {
        onClose();
      }, 800);
    } catch (err) {
      setMsg("Error creating record");
    } finally {
      setLoading(false);
    }
  }

  /* ---------------- UI ---------------- */

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-center items-start p-6">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white w-full max-w-xl rounded shadow-lg p-4">
        <h3 className="text-lg font-semibold mb-4">Add Registrant (Admin)</h3>

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

            <button
              className="px-4 py-2 bg-blue-600 text-white rounded"
              onClick={() =>
                role === "visitor" ? setStep("selectCategory") : loadConfig(role)
              }
            >
              Continue
            </button>
          </>
        )}

        {step === "selectCategory" && (
          <>
            <TicketCategorySelector
              role={role}
              value={ticketCategory}
              onChange={(v) => setTicketCategory(v)}
            />
            <button
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded"
              onClick={() => loadConfig(role)}
            >
              Continue
            </button>
          </>
        )}

        {step === "form" && (
          <form onSubmit={handleCreate} className="space-y-3">
            {fields.map((f) => (
              <div key={f.name}>
                <label className="block mb-1">
                  {f.label} {f.required && "*"}
                </label>
                <input
                  className="w-full border px-3 py-2"
                  value={values[f.name] || ""}
                  onChange={(e) =>
                    setValues((s) => ({ ...s, [f.name]: e.target.value }))
                  }
                  required={f.required}
                />
              </div>
            ))}

            <div className="flex gap-3 items-center">
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 bg-green-600 text-white rounded"
              >
                {loading ? "Creating..." : "Create"}
              </button>
              <span className="text-sm text-gray-600">{msg}</span>
            </div>
          </form>
        )}

        {step === "done" && (
          <ThankYouMessage messageOverride="Created successfully (email not sent)" />
        )}
      </div>
    </div>
  );
}
