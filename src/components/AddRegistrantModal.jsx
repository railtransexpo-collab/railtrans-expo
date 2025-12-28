import React, { useEffect, useRef, useState } from "react";
import TicketCategorySelector from "../components/TicketCategoryGenerator";
import ThankYouMessage from "../components/ThankYouMessage";
import { buildTicketEmail } from "../utils/emailTemplate";

/**
 * AddRegistrantModal (admin)
 *
 * Key points:
 * - This component is the single place that controls whether to show ticket categories.
 *   It shows TicketCategorySelector only for visitors (role === "visitor" or "visitors").
 * - It posts to /api/<collection> to create the record.
 * - If the server response doesn't include a successful mail result, it will attempt a
 *   client-side templated send using buildTicketEmail -> POST to /api/mailer (then /api/email).
 * - As a last-resort (optional) it can call the server resend endpoint if provided.
 *
 * This file intentionally does NOT modify the TicketCategorySelector component.
 */

export default function AddRegistrantModal({
  open,
  onClose,
  onCreated,
  defaultRole = "visitor",
  apiBase = "",
  enableResend = true, // keep resend optional
}) {
  const ROLE_OPTIONS = ["visitor", "exhibitor", "partner", "speaker", "awardee"];
  const [step, setStep] = useState("selectRole"); // selectRole | selectCategory | form | thanks
  const [role, setRole] = useState(defaultRole || "visitor");
  const [ticketCategory, setTicketCategory] = useState("");
  const [ticketMeta, setTicketMeta] = useState(null);
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [emailChecking, setEmailChecking] = useState(false);
  const [emailExistsInfo, setEmailExistsInfo] = useState(null);
  const emailDebounceRef = useRef(null);

  useEffect(() => {
    if (open) {
      reset();
      setRole(defaultRole || "visitor");
    } else {
      clearTimers();
    }
    // eslint-disable-next-line
  }, [open, defaultRole]);

  function apiUrl(path) {
    const base = (apiBase || (typeof window !== "undefined" && window.__API_BASE__) || "").replace(/\/$/, "");
    if (!path) return base || path;
    if (/^https?:\/\//i.test(path)) return path;
    const p = path.startsWith("/") ? path : `/${path}`;
    return `${base || ""}${p}`;
  }

  function clearTimers() {
    if (emailDebounceRef.current) {
      clearTimeout(emailDebounceRef.current);
      emailDebounceRef.current = null;
    }
  }

  function reset() {
    clearTimers();
    setStep("selectRole");
    setTicketCategory("");
    setTicketMeta(null);
    setFields([]);
    setValues({});
    setLoadingConfig(false);
    setSubmitting(false);
    setMsg("");
    setEmailChecking(false);
    setEmailExistsInfo(null);
  }

  /* ----------------- config helpers ----------------- */
  function prettify(s) {
    if (!s) return "";
    const spaced = String(s).replace(/[_-]+/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
    return spaced.charAt(0).toUpperCase() + spaced.slice(1);
  }

  function normalizeConfigCols(configCols) {
    if (!Array.isArray(configCols)) return [];
    return configCols.map((c) => {
      if (typeof c === "string") return { name: c, label: prettify(c), type: "text", options: [], required: false, showIf: null, meta: {}, default: "" };
      const name = c.name || c.key || c.field || c.id;
      const rawType = (c.type || c.inputType || "text").toString().toLowerCase();
      const type = ["select", "dropdown"].includes(rawType) ? "select" : ["textarea"].includes(rawType) ? "textarea" : ["checkbox","bool","boolean"].includes(rawType) ? "checkbox" : ["email"].includes(rawType) ? "email" : ["number"].includes(rawType) ? "number" : "text";
      const rawOptions = Array.isArray(c.options) ? c.options : Array.isArray(c.choices) ? c.choices : Array.isArray(c.values) ? c.values : [];
      const options = rawOptions.map((o) => {
        if (o === null || o === undefined) return null;
        if (typeof o === "string" || typeof o === "number") return { value: String(o), label: String(o) };
        const value = o.value ?? o.id ?? o.key ?? o.code ?? o.name ?? o.label;
        const label = o.label ?? o.name ?? String(value);
        return { value: value === undefined ? "" : String(value), label: label === undefined ? String(value) : String(label) };
      }).filter(Boolean);

      const showIfRaw = c.showIf || c.show_if || c.condition || null;
      let showIf = null;
      if (showIfRaw && typeof showIfRaw === "object") {
        const field = showIfRaw.field || showIfRaw.name || showIfRaw.dependsOn || showIfRaw.on;
        const value = showIfRaw.value ?? showIfRaw.values ?? showIfRaw.equals ?? showIfRaw.eq ?? null;
        if (field && value !== null) showIf = { field, value };
      }

      // In admin modal, don't enable OTP
      const meta = Object.assign({}, c.meta || {});
      if (type === "email") meta.useOtp = false;

      return { name, label: c.label || c.title || name, type, options, required: !!c.required, showIf, meta, default: c.default ?? c.defaultValue ?? "" };
    });
  }

  async function fetchConfigForRole(selectedRole) {
    setLoadingConfig(true);
    setFields([]);
    setValues({});
    setMsg("");
    setEmailExistsInfo(null);
    try {
      const page = String(selectedRole || "").toLowerCase().replace(/s$/, "");
      const res = await fetch(apiUrl(`/api/registration-configs/${encodeURIComponent(page)}`));
      if (res.ok) {
        const js = await res.json().catch(() => null);
        const cfg = js && (js.config || js.value || js) ? (js.config || js.value || js) : null;
        let configCols = cfg ? (cfg.fields || cfg.columns || (cfg.form && cfg.form.fields) || null) : null;
        if (Array.isArray(configCols) && configCols.length > 0) {
          const normalized = normalizeConfigCols(configCols);
          setFields(normalized);
          const initial = {};
          normalized.forEach((f) => initial[f.name] = f.type === "checkbox" ? !!f.default : (f.default ?? ""));
          if (ticketCategory) initial.ticket_category = ticketCategory;
          setValues(initial);
          setStep("form");
          setLoadingConfig(false);
          return;
        }
      }
    } catch (e) {
      console.warn("fetchConfigForRole error", e);
    }
    // fallback fields
    const fallback = ["name", "email", "company"];
    const normalized = fallback.map((k) => ({ name: k, label: prettify(k), type: k === "email" ? "email" : "text", options: [], required: k === "email", showIf: null, meta: {}, default: "" }));
    const initial = {};
    normalized.forEach((f) => initial[f.name] = f.default ?? "");
    if (ticketCategory) initial.ticket_category = ticketCategory;
    setFields(normalized);
    setValues(initial);
    setStep("form");
    setLoadingConfig(false);
  }

  /* ---------- visibility / validation ---------- */
  function canonicalValue(v) {
    if (v === undefined || v === null) return "";
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v).trim().toLowerCase();
    if (typeof v === "object") {
      const candidates = [v.value, v.id, v.key, v.code, v.label, v.name];
      for (const c of candidates) if (c !== undefined && c !== null) { const s = String(c).trim(); if (s) return s.toLowerCase(); }
      return "";
    }
    return String(v).trim().toLowerCase();
  }
  function optionLabelForField(fieldName, storedVal) {
    if (!fieldName) return "";
    const f = fields.find((x) => x.name === fieldName);
    if (!f || !Array.isArray(f.options)) return "";
    const found = f.options.find((o) => String(o.value) === String(storedVal));
    if (found) return found.label ?? String(found.value);
    const found2 = f.options.find((o) => String(o.label).toLowerCase() === String(storedVal).toLowerCase());
    if (found2) return found2.label ?? String(found2.value);
    return "";
  }
  function isFieldVisible(f) {
    if (!f || !f.showIf) return true;
    const dep = f.showIf.field;
    const expected = f.showIf.value;
    const currentRaw = values[dep];
    const cur = canonicalValue(currentRaw);
    const altLabel = canonicalValue(optionLabelForField(dep, currentRaw));
    const expectedCanon = (v) => canonicalValue(v);
    if (Array.isArray(expected)) {
      const exSet = new Set(expected.map(expectedCanon));
      return exSet.has(cur) || (altLabel && exSet.has(altLabel));
    }
    const eCanon = expectedCanon(expected);
    return cur === eCanon || (altLabel && altLabel === eCanon);
  }

  function validateValues() {
    for (const f of fields) {
      if (!isFieldVisible(f)) continue;
      if (f.required) {
        const v = values[f.name];
        if (f.type === "checkbox") { if (!v) return `${f.label} is required`; }
        else if (v === undefined || v === null || String(v).trim() === "") return `${f.label} is required`;
      }
      if (f.type === "email" && values[f.name]) {
        const v = String(values[f.name]);
        if (!/\S+@\S+\.\S+/.test(v)) return `${f.label} must be a valid email`;
      }
    }
    return null;
  }

  /* ---------- email existence check (no OTP UI) ---------- */
  function scheduleEmailCheck(emailVal) {
    if (!emailVal || !/\S+@\S+\.\S+/.test(String(emailVal))) { setEmailExistsInfo(null); return; }
    clearTimers();
    emailDebounceRef.current = setTimeout(() => runEmailCheck(emailVal), 350);
  }
  async function runEmailCheck(emailVal) {
    setEmailChecking(true);
    setEmailExistsInfo(null);
    try {
      const url = apiUrl(`/api/otp/check-email?email=${encodeURIComponent(String(emailVal))}&type=${encodeURIComponent(role)}`);
      const res = await fetch(url);
      if (!res.ok) { setEmailChecking(false); return; }
      const js = await res.json().catch(() => null);
      if (js && js.found) setEmailExistsInfo(js.info || js.existing || js);
      else setEmailExistsInfo(null);
    } catch (e) { setEmailExistsInfo(null); } finally { setEmailChecking(false); }
  }

  function setFieldValue(name, val) {
    let storeVal = val;
    if (typeof val === "object" && val !== null) storeVal = val.value ?? val.id ?? val.key ?? JSON.stringify(val);
    setValues((s) => ({ ...s, [name]: storeVal }));
    if (/email/i.test(name)) { setEmailExistsInfo(null); scheduleEmailCheck(storeVal); }
  }

  /* ---------- mail helpers ---------- */
  async function postMailer(payload) {
    const endpoints = [
      `${apiUrl("/api/mailer")}`,
      `${apiUrl("/api/email")}`,
      `/api/mailer`,
      `/api/email`,
    ].filter(Boolean);
    let lastErr = null;
    for (const url of endpoints) {
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" },
          body: JSON.stringify(payload),
        });
        const body = await r.json().catch(() => null);
        if (r.ok) return { ok: true, body, url, status: r.status };
        if (r.status === 404) { lastErr = { status: r.status, body, url }; continue; }
        return { ok: false, status: r.status, body, url };
      } catch (err) { lastErr = err; continue; }
    }
    return { ok: false, error: lastErr || "all endpoints failed" };
  }

  function normalizeAdminUrl(u) {
    try {
      if (!u) return "";
      const t = String(u).trim();
      if (!t) return "";
      if (/^https?:\/\//i.test(t)) return t;
      if (t.startsWith("//")) return (typeof window !== "undefined" && window.location ? window.location.protocol : "https:") + t;
      if (t.startsWith("/")) return (typeof window !== "undefined" && (window.__FRONTEND_BASE__ || window.location.origin)) + t;
      return (typeof window !== "undefined" && (window.__FRONTEND_BASE__ || window.location.origin)) + "/" + t.replace(/^\//, "");
    } catch { return ""; }
  }

  function isImageAttachment(a = {}) {
    const ct = String(a.contentType || a.content_type || a.type || "").toLowerCase();
    if (ct && ct.startsWith("image/")) return true;
    const fn = String(a.filename || a.name || a.path || "").toLowerCase();
    if (fn && (fn.endsWith(".png") || fn.endsWith(".jpg") || fn.endsWith(".jpeg") || fn.endsWith(".gif") || fn.endsWith(".svg") || fn.endsWith(".webp"))) return true;
    return false;
  }

  async function sendTicketEmailUsingTemplate({ visitor, config: cfg = {} } = {}) {
    try {
      const frontendBase = (typeof window !== "undefined" && (window.__FRONTEND_BASE__ || window.location.origin)) || "";
      const visitorId = visitor?.id || visitor?._id || visitor?.insertedId || "";
      const ticketCode = visitor?.ticket_code || visitor?.ticketCode || "";
      const downloadUrl = `${frontendBase.replace(/\/$/, "")}/ticket-download?entity=${encodeURIComponent(role + "s")}&${visitorId ? `id=${encodeURIComponent(String(visitorId))}` : `ticket_code=${encodeURIComponent(String(ticketCode || ""))}`}`;
      const logoUrl = normalizeAdminUrl(cfg.logoUrl || cfg.topbarLogo || (cfg.adminTopbar && cfg.adminTopbar.logoUrl) || "");

      const emailModel = {
        frontendBase,
        entity: role + "s",
        id: visitorId,
        name: visitor?.name || values.name || "",
        company: visitor?.company || values.company || "",
        ticket_code: ticketCode,
        ticket_category: visitor?.ticket_category || visitor?.ticketCategory || ticketCategory || "",
        badgePreviewUrl: "",
        downloadUrl,
        form: visitor || values || null,
        logoUrl,
        event: cfg?.eventDetails || null,
      };

      const tpl = await buildTicketEmail(emailModel);
      const subject = tpl.subject || `Registration — ${cfg?.eventDetails?.name || ""}`;
      const text = tpl.text || "";
      const html = tpl.html || "";
      const templateAttachments = Array.isArray(tpl.attachments) ? tpl.attachments : [];
      const attachments = templateAttachments.filter((a) => !isImageAttachment(a)).map((a) => {
        const out = {};
        if (a.filename) out.filename = a.filename;
        if (a.content) out.content = a.content;
        if (a.encoding) out.encoding = a.encoding;
        if (a.contentType || a.content_type) out.contentType = a.contentType || a.content_type;
        if (a.path) out.path = a.path;
        return out;
      });

      return await postMailer({ to: visitor?.email || values.email, subject, text, html, attachments });
    } catch (e) {
      return { ok: false, error: String(e && (e.message || e)) };
    }
  }

  /* ---------- step handlers ---------- */
  function handleContinueToCategory(e) {
    e && e.preventDefault();
    // show category selector only for visitors
    const r = String(role || "").toLowerCase();
    if (r === "visitor" || r === "visitors") setStep("selectCategory");
    else fetchConfigForRole(role);
  }

  function handleCategorySelected(value, meta) {
    setTicketCategory(value);
    setTicketMeta(meta || null);
    fetchConfigForRole(role);
  }

  async function handleSubmit(e) {
    e && e.preventDefault();
    setMsg("");
    const vErr = validateValues();
    if (vErr) { setMsg(vErr); return; }

    const emailKey = Object.keys(values || {}).find((k) => /email/i.test(k));
    const emailVal = emailKey ? values[emailKey] : null;
    if (emailVal && emailExistsInfo) {
      const proceed = window.confirm(`There is an existing record for this email in ${emailExistsInfo.collection || "records"}. Proceed and create a new record anyway?`);
      if (!proceed) { setMsg("Cancelled: duplicate email detected"); return; }
    }

    setSubmitting(true);
    try {
      const collection = `${role}s`;
      const url = apiUrl(`/api/${collection}`);
      const payload = { ...values, added_by_admin: true, admin_created_at: new Date().toISOString(), ticket_category: ticketCategory || values.ticket_category || null };
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" }, body: JSON.stringify(payload) });
      const js = await res.json().catch(() => null);
      if (!res.ok) {
        const txt = (js && (js.error || js.message)) || (await res.text().catch(() => null));
        setMsg(`Failed to create: ${txt || res.status}`);
        setSubmitting(false);
        return;
      }

      const createdDoc = js?.saved || js?.doc || (js && (js.insertedId || js.inserted_id) ? { insertedId: js.insertedId || js.inserted_id } : (js || {}));
      const resolvedId = createdDoc.id || createdDoc._id || js?.insertedId || js?.inserted_id || createdDoc.insertedId;
      if (resolvedId) createdDoc.id = String(resolvedId);
      createdDoc.added_by_admin = true;
      if (js && js.mail) createdDoc.mail = js.mail;

      // If server didn't send mail successfully, attempt client-side template send, then optional server resend.
      const mailOk = createdDoc.mail && (createdDoc.mail.ok === true || createdDoc.mail.success === true);
      const idToUse = createdDoc.id || createdDoc._id || (js && (js.insertedId || js.inserted_id)) || null;

      if (!mailOk && idToUse) {
        // 1) try templated client send
        try {
          const visitorForEmail = { ...createdDoc, ...values };
          if (!visitorForEmail.email && values.email) visitorForEmail.email = values.email;
          const tplRes = await sendTicketEmailUsingTemplate({ visitor: visitorForEmail, config: {} });
          if (tplRes && tplRes.ok) {
            createdDoc.mail = { ok: true, info: tplRes.body || tplRes };
          } else {
            createdDoc.mail = { ok: false, error: tplRes && (tplRes.error || (tplRes.body && (tplRes.body.error || tplRes.body.message))) || "templated send failed" };
            // 2) fallback to server resend endpoint if enabled
            if (enableResend) {
              try {
                const resendUrl = apiUrl(`/api/${collection}/${encodeURIComponent(String(idToUse))}/resend-email`);
                const rres = await fetch(resendUrl, { method: "POST", headers: { "Content-Type": "application/json", "ngrok-skip-browser-warning": "69420" } });
                const rjs = await rres.json().catch(() => null);
                if (rres.ok) createdDoc.mail = rjs || { ok: true };
                else createdDoc.mail = rjs || { ok: false, error: `resend failed ${rres.status}` };
              } catch (reErr) {
                createdDoc.mail = { ok: false, error: String(reErr && (reErr.message || reErr)) };
              }
            }
          }
        } catch (err) {
          createdDoc.mail = { ok: false, error: String(err && (err.message || err)) };
        }
      }

      onCreated && onCreated(createdDoc, collection);

      setMsg(createdDoc.mail && createdDoc.mail.ok ? "Created & email sent" : "Created (email not sent)");
      setStep("thanks");
      setTimeout(() => {
        setSubmitting(false);
        onClose && onClose();
      }, 900);
    } catch (err) {
      setMsg(`Error: ${err && (err.message || err)}`);
      setSubmitting(false);
    }
  }

  /* ----------------- UI ----------------- */
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-6">
      <div className="absolute inset-0 bg-black opacity-40" onClick={() => onClose && onClose()} />
      <div className="relative z-60 w-full max-w-2xl bg-white rounded shadow-lg overflow-auto" style={{ maxHeight: "90vh" }}>
        <div className="flex items-center justify-between p-3 border-b">
          <h3 className="text-lg font-semibold">Add Registrant (Admin)</h3>
          <div>
            <button className="px-3 py-1 mr-2 border rounded" onClick={() => onClose && onClose()}>Close</button>
          </div>
        </div>

        <div className="p-4">
          {step === "selectRole" && (
            <form onSubmit={(e) => { e && e.preventDefault(); handleContinueToCategory(e); }} className="space-y-4">
              <div>
                <label className="block mb-1 font-medium">Select Role</label>
                <select value={role} onChange={(e) => setRole(e.target.value)} className="w-full border px-2 py-1 rounded">
                  {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{r.charAt(0).toUpperCase() + r.slice(1)}</option>)}
                </select>
              </div>

              <div className="flex justify-end gap-2">
                <button type="button" className="px-3 py-2 border rounded" onClick={() => onClose && onClose()}>Cancel</button>
                <button type="submit" className="px-3 py-2 bg-blue-600 text-white rounded">Continue</button>
              </div>
            </form>
          )}

          {step === "selectCategory" && (
            <div className="space-y-4">
              <div className="mb-4">
                <div className="font-medium mb-2">Select Ticket Category (visitors only)</div>
                <TicketCategorySelector role={role} value={ticketCategory} onChange={(val, meta) => handleCategorySelected(val, meta)} />
              </div>
              <div className="flex justify-end gap-2">
                <button className="px-3 py-2 border rounded" onClick={() => setStep("selectRole")}>Back</button>
                <button className="px-3 py-2 bg-gray-100 text-gray-700 rounded" onClick={() => fetchConfigForRole(role)}>Skip & Open Form</button>
              </div>
            </div>
          )}

          {step === "form" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              {fields.map((f) => {
                if (!isFieldVisible(f)) return null;
                const val = values[f.name] ?? "";

                if (f.type === "textarea") {
                  return (
                    <div key={f.name}>
                      <label className="block mb-1">{f.label}{f.required && " *"}</label>
                      <textarea className="w-full border rounded px-3 py-2" value={val} onChange={(e) => setFieldValue(f.name, e.target.value)} />
                    </div>
                  );
                }

                const hasOptions = Array.isArray(f.options) && f.options.length > 0;
                if (f.type === "select" || hasOptions) {
                  return (
                    <div key={f.name}>
                      <label className="block mb-1">{f.label}{f.required && " *"}</label>
                      <select className="w-full border rounded px-2 py-1" value={val} onChange={(e) => setFieldValue(f.name, e.target.value)}>
                        <option value="">{f.required ? "Select" : "None"}</option>
                        {Array.isArray(f.options) && f.options.map((o, i) => {
                          const valOpt = typeof o === "object" ? (o.value ?? o.label ?? String(i)) : String(o);
                          const lab = typeof o === "object" ? (o.label ?? String(valOpt)) : String(o);
                          return <option key={String(valOpt ?? i)} value={valOpt}>{lab}</option>;
                        })}
                      </select>
                    </div>
                  );
                }

                if (f.type === "checkbox") {
                  return (
                    <label key={f.name} className="flex items-center gap-2">
                      <input type="checkbox" checked={!!val} onChange={(e) => setFieldValue(f.name, e.target.checked)} />
                      <span>{f.label}{f.required && " *"}</span>
                    </label>
                  );
                }

                return (
                  <div key={f.name}>
                    <label className="block mb-1">{f.label}{f.required && " *"}</label>
                    <input
                      type={f.type === "email" ? "email" : f.type === "number" ? "number" : "text"}
                      className="w-full border rounded px-3 py-2"
                      value={val}
                      onChange={(e) => setFieldValue(f.name, e.target.value)}
                      onBlur={() => { if (f.type === "email") scheduleEmailCheck(values[f.name]); }}
                    />
                    {f.type === "email" && (
                      <div className="mt-2 text-sm">
                        {emailChecking && <span className="text-gray-500">Checking email...</span>}
                        {!emailChecking && emailExistsInfo && <span className="text-yellow-700">⚠️ Email exists: {emailExistsInfo.name || ""} in {emailExistsInfo.collection || "records"}</span>}
                      </div>
                    )}
                  </div>
                );
              })}

              <div className="flex items-center gap-2">
                <button type="button" className="px-3 py-2 border rounded" onClick={() => { setStep("selectRole"); setFields([]); setValues({}); setEmailExistsInfo(null); }}>Back</button>

                <button type="submit" disabled={submitting} className="px-3 py-2 bg-blue-600 text-white rounded">
                  {submitting ? "Creating..." : "Create & Send"}
                </button>

                <div className="text-sm text-gray-600">{msg}</div>
              </div>
            </form>
          )}

          {step === "thanks" && (
            <div>
              <ThankYouMessage email={values.email || ""} messageOverride={msg || "Created successfully"} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}