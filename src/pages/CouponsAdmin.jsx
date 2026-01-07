import React, { useEffect, useState } from 'react';

/**
 * Admin UI for Coupons
 *
 * - Create single coupon (code optional) with discount percent
 * - Bulk generate coupons (count + discount)
 * - List coupons with filters: All / Unused / Used
 * - Actions: Delete, Mark Used, Unmark (admin)
 * - Validate/apply coupon: enter code + price -> show reduced price; optionally mark used
 *
 * Place this page under your admin routes, e.g. /admin/coupons
 */

const API_BASE = (window && (window.__API_BASE__ || '')) || '';

function apiUrl(path) {
  if (!path) return API_BASE;
  if (/^https?:\/\//i.test(path)) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE.replace(/\/$/, '')}${p}`;
}

function shortDate(d) {
  if (!d) return '-';
  try {
    return new Date(d).toLocaleString();
  } catch { return String(d); }
}

export default function CouponsAdmin() {
  const [loading, setLoading] = useState(true);
  const [coupons, setCoupons] = useState([]);
  const [filter, setFilter] = useState('all'); // all | unused | used
  const [logs, setLogs] = useState([]);

  // create form
  const [code, setCode] = useState('');
  const [discount, setDiscount] = useState(10);

  // bulk generate
  const [bulkCount, setBulkCount] = useState(10);
  const [bulkDiscount, setBulkDiscount] = useState(10);

  // validate form
  const [validateCode, setValidateCode] = useState('');
  const [validatePrice, setValidatePrice] = useState('');
  const [validateResult, setValidateResult] = useState(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function loadCoupons() {
    setLoading(true);
    try {
      const res = await fetch(apiUrl(`/api/coupons?status=${encodeURIComponent(filter)}`));
      if (!res.ok) {
        const txt = await res.text().catch(()=>null);
        throw new Error(txt || `status ${res.status}`);
      }
      const js = await res.json().catch(()=>null);
      setCoupons(js && js.coupons ? js.coupons : []);
    } catch (e) {
      console.error('loadCoupons error', e);
      setError('Failed to load coupons');
    } finally {
      setLoading(false);
    }
  }

  async function loadLogs() {
    try {
      const res = await fetch(apiUrl('/api/coupons/logs'));
      if (!res.ok) return;
      const js = await res.json().catch(()=>null);
      setLogs(js && js.logs ? js.logs : []);
    } catch (e) {
      console.warn('loadLogs failed', e);
    }
  }

  useEffect(() => {
    loadCoupons();
    loadLogs();
    // eslint-disable-next-line
  }, [filter]);

  async function createCoupon(e) {
    e && e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = { code: code ? String(code).trim() : undefined, discount: Number(discount || 0) };
      const res = await fetch(apiUrl('/api/coupons'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const js = await res.json().catch(()=>null);
      if (!res.ok) {
        throw new Error((js && js.error) || 'Create failed');
      }
      setCode('');
      setDiscount(10);
      await loadCoupons();
      await loadLogs();
    } catch (e) {
      console.error('createCoupon', e);
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function generateBulk(e) {
    e && e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const payload = { count: Number(bulkCount || 10), discount: Number(bulkDiscount || 0) };
      const res = await fetch(apiUrl('/api/coupons/generate'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const js = await res.json().catch(()=>null);
      if (!res.ok) throw new Error((js && js.error) || 'Generate failed');
      await loadCoupons();
      await loadLogs();
    } catch (e) {
      console.error('generateBulk', e);
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deleteCoupon(id) {
    if (!window.confirm('Delete this coupon?')) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/coupons/${encodeURIComponent(id)}`), { method: 'DELETE' });
      const js = await res.json().catch(()=>null);
      if (!res.ok) throw new Error((js && js.error) || 'Delete failed');
      await loadCoupons();
      await loadLogs();
    } catch (e) {
      console.error('deleteCoupon', e);
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function markUsed(id) {
    if (!window.confirm('Mark coupon as used?')) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/coupons/${encodeURIComponent(id)}/use`), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ used_by: 'admin' }) });
      const js = await res.json().catch(()=>null);
      if (!res.ok) throw new Error((js && js.error) || 'Mark used failed');
      await loadCoupons();
      await loadLogs();
    } catch (e) {
      console.error('markUsed', e);
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function unmarkUsed(id) {
    if (!window.confirm('Unmark coupon as used?')) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl(`/api/coupons/${encodeURIComponent(id)}/unuse`), { method: 'POST' });
      const js = await res.json().catch(()=>null);
      if (!res.ok) throw new Error((js && js.error) || 'Unmark failed');
      await loadCoupons();
      await loadLogs();
    } catch (e) {
      console.error('unmarkUsed', e);
      setError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function applyValidate(markUsed = false) {
    setError('');
    setValidateResult(null);
    try {
      const payload = { code: String(validateCode || '').trim().toUpperCase(), price: Number(validatePrice || undefined), markUsed };
      const res = await fetch(apiUrl('/api/coupons/validate'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const js = await res.json().catch(()=>null);
      if (!res.ok || !js) {
        throw new Error((js && js.error) || `status ${res.status}`);
      }
      setValidateResult(js);
      // refresh lists if marked used
      if (markUsed) {
        await loadCoupons();
        await loadLogs();
      }
    } catch (e) {
      console.error('applyValidate', e);
      setError(e && e.message ? e.message : String(e));
    }
  }

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <h1 className="text-2xl font-bold mb-4">Coupons Admin</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
        <section className="p-4 border rounded bg-white shadow">
          <h2 className="font-semibold mb-2">Add Coupon</h2>
          <form onSubmit={createCoupon} className="space-y-2">
            <div>
              <label className="block text-sm">Coupon Code (optional)</label>
              <input value={code} onChange={e => setCode(e.target.value)} className="border rounded px-2 py-1 w-full" placeholder="AUTO if left blank" />
            </div>
            <div>
              <label className="block text-sm">Discount %</label>
              <input type="number" value={discount} onChange={e => setDiscount(e.target.value)} className="border rounded px-2 py-1 w-full" min="0" max="100" />
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-1 bg-[#196e87] text-white rounded" disabled={busy}>Create</button>
              <button type="button" onClick={() => { setCode(''); setDiscount(10); }} className="px-3 py-1 border rounded">Reset</button>
            </div>
          </form>
        </section>

        <section className="p-4 border rounded bg-white shadow">
          <h2 className="font-semibold mb-2">Bulk Generate</h2>
          <form onSubmit={generateBulk} className="space-y-2">
            <div>
              <label className="block text-sm">Count</label>
              <input type="number" value={bulkCount} onChange={e => setBulkCount(e.target.value)} className="border rounded px-2 py-1 w-full" min="1" max="500" />
            </div>
            <div>
              <label className="block text-sm">Discount %</label>
              <input type="number" value={bulkDiscount} onChange={e => setBulkDiscount(e.target.value)} className="border rounded px-2 py-1 w-full" min="0" max="100" />
            </div>
            <div className="flex gap-2">
              <button className="px-3 py-1 bg-[#196e87] text-white rounded" disabled={busy}>Generate</button>
              <button type="button" onClick={() => { setBulkCount(10); setBulkDiscount(10); }} className="px-3 py-1 border rounded">Reset</button>
            </div>
          </form>
        </section>
      </div>

      <div className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Apply / Validate Coupon</h2>
        <div className="flex gap-2 items-end">
          <div>
            <label className="block text-sm">Code</label>
            <input value={validateCode} onChange={e => setValidateCode(e.target.value)} className="border rounded px-2 py-1" />
          </div>
          <div>
            <label className="block text-sm">Price</label>
            <input value={validatePrice} onChange={e => setValidatePrice(e.target.value)} type="number" className="border rounded px-2 py-1" />
          </div>
          <div className="flex gap-2">
            <button className="px-3 py-1 bg-blue-600 text-white rounded" onClick={() => applyValidate(false)}>Check</button>
            <button className="px-3 py-1 bg-green-600 text-white rounded" onClick={() => applyValidate(true)}>Apply & Mark Used</button>
          </div>
        </div>
        {validateResult && (
          <div className="mt-3 p-3 border rounded bg-gray-50">
            <pre>{JSON.stringify(validateResult, null, 2)}</pre>
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center gap-3">
        <button onClick={() => setFilter('all')} className={`px-3 py-1 rounded ${filter==='all' ? 'bg-[#196e87] text-white' : 'bg-gray-100'}`}>All</button>
        <button onClick={() => setFilter('unused')} className={`px-3 py-1 rounded ${filter==='unused' ? 'bg-[#196e87] text-white' : 'bg-gray-100'}`}>Unused</button>
        <button onClick={() => setFilter('used')} className={`px-3 py-1 rounded ${filter==='used' ? 'bg-[#196e87] text-white' : 'bg-gray-100'}`}>Used</button>
        <div className="ml-auto text-sm text-gray-600">{loading ? 'Loading...' : `${coupons.length} coupons`}</div>
      </div>

      <div className="grid gap-2">
        {error && <div className="text-red-600">{error}</div>}
        {!loading && coupons.length === 0 && <div className="text-gray-600">No coupons</div>}

        {coupons.map(c => (
          <div key={c.id || c.code} className={`p-3 rounded border flex items-center justify-between ${c.used ? 'bg-gray-100 opacity-80' : 'bg-white'}`}>
            <div>
              <div className="font-mono text-lg">{c.code}</div>
              <div className="text-sm text-gray-600">Discount: {c.discount}% — Created: {shortDate(c.created_at)}</div>
              {c.used && <div className="text-sm text-red-600">Used by: {c.used_by || 'unknown'} at {shortDate(c.used_at)}</div>}
            </div>
            <div className="flex flex-col items-end gap-2">
              {!c.used ? (
                <button className="px-3 py-1 bg-green-600 text-white rounded" onClick={() => markUsed(c.id)}>Mark Used</button>
              ) : (
                <button className="px-3 py-1 bg-yellow-500 text-white rounded" onClick={() => unmarkUsed(c.id)}>Unmark</button>
              )}
              <button className="px-3 py-1 border rounded" onClick={() => deleteCoupon(c.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6">
        <h3 className="font-semibold mb-2">Recent Logs</h3>
        <div className="bg-white p-3 border rounded space-y-2">
          {logs.length === 0 && <div className="text-gray-600">No logs</div>}
          {logs.slice(0, 50).map((l, i) => (
            <div key={i} className="text-sm text-gray-700">
              <strong>{l.type}</strong> — {l.code || l.couponId || ''} — {shortDate(l.created_at)} {l.used_by ? ` by ${l.used_by}` : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}