import React, { useEffect, useState } from "react";
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
    setLoading(false);
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
      console.error("AddRegistrantModal create error", err);
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
      <div
        className="relative bg-white w-full max-w-xl rounded shadow-lg"
        style={{ maxHeight: "80vh", width: "100%", overflow: "hidden" }}
      >
        <div className="p-4 border-b">
          <h3 className="text-lg font-semibold">Add Registrant (Admin)</h3>
        </div>

        {/* Scrollable content area */}
        <div
          className="p-4 overflow-y-auto"
          style={{ maxHeight: "calc(80vh - 140px)" /* leave room for header/footer */ }}
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
                onChange={(v) => setTicketCategory(v)}
              />
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
                      onChange={(e) => updateValue(key, e.target.value, f.type)}
                      required={required}
                      type={inputType}
                    />
                  </div>
                );
              })}

              <div className="flex gap-3 items-center mt-4">
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-green-600 text-white rounded"
                >
                  {loading ? "Creating..." : "Create"}
                </button>
                <button
                  type="button"
                  className="px-4 py-2 border rounded"
                  onClick={() => {
                    setStep("selectRole");
                  }}
                >
                  Cancel
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
    </div>
  );
}