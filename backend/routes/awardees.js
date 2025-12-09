const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { ObjectId } = require('mongodb');
const mongo = require('../utils/mongoClient'); // must expose getDb() or .db

// Try to reuse safeFieldName if available, otherwise provide local fallback
let safeFieldName;
try {
  safeFieldName = require('../utils/mongoSchemaSync').safeFieldName;
} catch (e) {
  safeFieldName = function (name) {
    if (!name) return null;
    let s = String(name).trim().toLowerCase().replace(/[\s-]+/g, '_').replace(/[^a-z0-9_]/g, '');
    if (!/^[a-z_]/.test(s)) s = `f_${s}`;
    return s;
  };
}

// body parser for router
router.use(express.json({ limit: '5mb' }));

// Ensure uploads directory exists (same location used by SQL version)
const UPLOADS_DIR = path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Multer disk storage (simple)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '') || '';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2,8)}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 300 * 1024 * 1024 } });

async function obtainDb() {
  if (!mongo) return null;
  if (typeof mongo.getDb === 'function') return await mongo.getDb();
  if (mongo.db) return mongo.db;
  return null;
}

function docToOutput(doc) {
  if (!doc) return null;
  const out = { ...(doc || {}) };
  if (out._id) {
    out.id = String(out._id);
    delete out._id;
  }
  return out;
}

function convertBigIntForJson(value) {
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(convertBigIntForJson);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = convertBigIntForJson(v);
    return out;
  }
  return value;
}

// Simple ticket code generator (keeps behaviour similar to SQL version)
function generateTicketCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

/**
 * Helper: load admin-config fields for a page (awardee)
 * Returns { originalNames: Set, safeNames: Set, fieldsArray }
 */
async function loadAdminFields(db, pageName = 'awardee') {
  try {
    const col = db.collection('registration_configs');
    const doc = await col.findOne({ page: pageName });
    const fields = (doc && doc.config && Array.isArray(doc.config.fields)) ? doc.config.fields : [];
    const originalNames = new Set();
    const safeNames = new Set();
    for (const f of fields) {
      if (!f || !f.name) continue;
      const name = String(f.name).trim();
      if (!name) continue;
      originalNames.add(name);
      const sn = safeFieldName(name);
      if (sn) safeNames.add(sn);
    }
    return { originalNames, safeNames, fields };
  } catch (e) {
    return { originalNames: new Set(), safeNames: new Set(), fields: [] };
  }
}

/**
 * POST /api/awardees
 * Create a new awardee
 */
router.post('/', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });

    const body = req.body || {};

    const pick = (cands) => {
      for (const k of cands) {
        if (Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined && body[k] !== null) return body[k];
      }
      for (const bk of Object.keys(body)) {
        for (const k of cands) {
          if (bk.toLowerCase() === String(k).toLowerCase()) return body[bk];
        }
      }
      return undefined;
    };

    const name = String(pick(['name','fullName','full_name','firstName','first_name']) || '').trim();
    const mobile = String(pick(['mobile','phone','contact','whatsapp']) || '').trim();
    const email = String(pick(['email','mail','emailId','email_id']) || '').trim();
    const designation = String(pick(['designation','title','role']) || '').trim();
    const organization = String(pick(['organization','org','company']) || '').trim();
    const awardType = String(pick(['awardType','award','type']) || '').trim();
    const awardOther = String(pick(['awardOther','award_other']) || '').trim();
    const bio = String(pick(['bio','about']) || '').trim();

    // minimal validation
    if (!name && !organization) {
      return res.status(400).json({ success: false, error: 'name or organization required' });
    }

    const doc = {
      name: name || null,
      mobile: mobile || null,
      email: email || null,
      designation: designation || null,
      organization: organization || null,
      awardType: awardType || null,
      awardOther: awardOther || null,
      bio: bio || null,
      ticket_code: generateTicketCode(),
      ticket_category: body.ticket_category || body.ticketCategory || null,
      txId: body.txId || body.txid || null,
      created_at: new Date(),
      registered_at: body.registered_at ? new Date(body.registered_at) : new Date(),
      proof_path: null,
      status: 'pending',
      updated_at: new Date(),
    };

    const col = db.collection('awardees');
    const r = await col.insertOne(doc);
    const insertedId = r.insertedId ? String(r.insertedId) : null;

    const saved = await col.findOne({ _id: r.insertedId });

    return res.json(convertBigIntForJson({ success: true, insertedId, ticket_code: doc.ticket_code, saved: docToOutput(saved) }));
  } catch (err) {
    console.error('[awardees] POST (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to create awardee' });
  }
});

/**
 * GET /api/awardees
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(1000, Math.max(1, parseInt(req.query.limit || '200', 10)));
    const db = await obtainDb();
    if (!db) return res.status(500).json({ error: 'database not available' });
    const rows = await db.collection('awardees').find({}).sort({ created_at: -1 }).limit(limit).toArray();
    return res.json(convertBigIntForJson(rows.map(docToOutput)));
  } catch (err) {
    console.error('[awardees] GET (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ error: 'Failed to fetch awardees' });
  }
});

/**
 * GET /api/awardees/stats
 * NOTE: place before dynamic /:id route to avoid route collisions (e.g. id === 'stats')
 */
router.get('/stats', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ error: 'database not available' });

    const total = await db.collection('awardees').countDocuments({});
    const paid = await db.collection('awardees').countDocuments({ txId: { $exists: true, $ne: null, $ne: "" } });
    // free where ticket_category contains free|general|0 (case-insensitive)
    const free = await db.collection('awardees').countDocuments({ ticket_category: { $regex: /(free|general|^0$)/i } });

    return res.json({ total, paid, free });
  } catch (err) {
    console.error('[awardees] stats (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ error: 'Failed to compute stats' });
  }
});

/**
 * GET /api/awardees/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ error: 'database not available' });
    let oid;
    try { oid = new ObjectId(req.params.id); } catch { return res.status(400).json({ error: 'invalid id' }); }
    const doc = await db.collection('awardees').findOne({ _id: oid });
    return res.json(convertBigIntForJson(docToOutput(doc) || {}));
  } catch (err) {
    console.error('[awardees] GET/:id (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ error: 'Failed to fetch awardee' });
  }
});

/**
 * POST /api/awardees/:id/confirm
 * Safe update similar to SQL version but extended to allow admin-configured dynamic fields.
 */
router.post('/:id/confirm', express.json(), async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });

    const id = req.params.id;
    let oid;
    try { oid = new ObjectId(id); } catch { return res.status(400).json({ success: false, error: 'invalid id' }); }

    const payload = { ...(req.body || {}) };
    const force = !!payload.force;
    delete payload.force;

    const existing = await db.collection('awardees').findOne({ _id: oid });
    if (!existing) return res.status(404).json({ success: false, error: 'Awardee not found' });

    // base whitelist
    const baseWhitelist = new Set(['ticket_code','ticket_category','txId','email','name','organization','mobile','designation','awardType','awardOther','bio']);

    // include admin-configured fields (map originals to safe names)
    const { originalNames, safeNames } = await loadAdminFields(db, 'awardee');
    for (const n of originalNames) baseWhitelist.add(n);
    for (const sn of safeNames) baseWhitelist.add(sn);

    const updateData = {};
    for (const k of Object.keys(payload || {})) {
      // decide what target key to use
      if (!baseWhitelist.has(k)) {
        const sk = safeFieldName(k);
        if (!sk || !baseWhitelist.has(sk)) continue;
        updateData[sk] = payload[k];
      } else {
        // if key is an original admin name, normalize to safe name for consistency
        if (originalNames.has(k)) {
          const sn = safeFieldName(k);
          updateData[sn || k] = payload[k];
        } else {
          updateData[k] = payload[k];
        }
      }
    }

    // ticket_code defensive handling (handles both raw and normalized ticket_code)
    if ('ticket_code' in updateData) {
      const incoming = updateData.ticket_code ? String(updateData.ticket_code).trim() : "";
      const existingCode = existing.ticket_code ? String(existing.ticket_code).trim() : "";
      if (!incoming) delete updateData.ticket_code;
      else if (existingCode && !force && incoming !== existingCode) delete updateData.ticket_code;
    } else if ('ticketCode' in updateData) {
      // also consider camelCase variant
      const incoming = updateData.ticketCode ? String(updateData.ticketCode).trim() : "";
      const existingCode = existing.ticket_code ? String(existing.ticket_code).trim() : "";
      if (!incoming) delete updateData.ticketCode;
      else if (existingCode && !force && incoming !== existingCode) delete updateData.ticketCode;
    }

    if (Object.keys(updateData).length === 0) {
      return res.json({ success: true, updated: docToOutput(existing), note: 'No changes applied (ticket_code protected)' });
    }

    updateData.updated_at = new Date();

    await db.collection('awardees').updateOne({ _id: oid }, { $set: updateData });

    const after = await db.collection('awardees').findOne({ _id: oid });
    return res.json({ success: true, updated: docToOutput(after) });
  } catch (err) {
    console.error('[awardees] POST /:id/confirm (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to update awardee' });
  }
});

/**
 * PUT /api/awardees/:id
 * Update allowed fields — extended to permit admin-configured dynamic fields.
 */
router.put('/:id', express.json(), async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });
    let oid;
    try { oid = new ObjectId(req.params.id); } catch { return res.status(400).json({ success: false, error: 'invalid id' }); }

    const data = { ...(req.body || {}) };
    delete data.id;
    delete data.title;

    // base allowed (same as before)
    const allowedBase = new Set(['name','email','mobile','designation','organization','awardType','awardOther','bio','ticket_category','ticket_code','txId','registered_at','created_at','status','proof_path']);

    // add admin-configured fields (both original and normalized)
    const { originalNames, safeNames } = await loadAdminFields(db, 'awardee');
    for (const n of originalNames) allowedBase.add(n);
    for (const s of safeNames) allowedBase.add(s);

    const updateData = {};
    for (const [k, v] of Object.entries(data)) {
      if (!allowedBase.has(k)) {
        // try normalized version of incoming key
        const sk = safeFieldName(k);
        if (!sk || !allowedBase.has(sk)) continue;
        if ((sk === 'registered_at' || sk === 'created_at') && v) {
          const d = new Date(v);
          if (!isNaN(d.getTime())) updateData[sk] = d;
          continue;
        }
        updateData[sk] = v;
        continue;
      }

      if ((k === 'registered_at' || k === 'created_at') && v) {
        const d = new Date(v);
        if (!isNaN(d.getTime())) { updateData[k] = d; continue; }
      }

      // if k is an admin original name, map to safe name
      if (originalNames.has(k)) {
        const sn = safeFieldName(k);
        updateData[sn || k] = v;
      } else {
        updateData[k] = v;
      }
    }

    if (Object.keys(updateData).length === 0) return res.status(400).json({ success: false, error: 'No valid fields to update.' });

    updateData.updated_at = new Date();

    const r = await db.collection('awardees').updateOne({ _id: oid }, { $set: updateData });
    if (!r.matchedCount) return res.status(404).json({ success: false, error: 'Awardee not found' });

    return res.json({ success: true });
  } catch (err) {
    console.error('[awardees] PUT (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to update awardee', details: err && err.message });
  }
});

/**
 * POST /api/awardees/:id/upload-proof
 * Accept proof via multipart form (field 'proof'), store on disk and save path in doc
 */
router.post('/:id/upload-proof', upload.single('proof'), async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });
    const id = req.params.id;
    let oid;
    try { oid = new ObjectId(id); } catch { return res.status(400).json({ success: false, error: 'invalid id' }); }

    if (!req.file) return res.status(400).json({ success: false, error: 'No file uploaded' });

    const proofPath = path.relative(process.cwd(), req.file.path);
    await db.collection('awardees').updateOne({ _id: oid }, { $set: { proof_path: proofPath, updated_at: new Date() } });

    return res.json({ success: true, file: { filename: req.file.filename, path: proofPath, size: req.file.size } });
  } catch (err) {
    console.error('[awardees] upload-proof (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to upload proof' });
  }
});

/**
 * DELETE /api/awardees/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });
    let oid;
    try { oid = new ObjectId(req.params.id); } catch { return res.status(400).json({ success: false, error: 'invalid id' }); }

    const r = await db.collection('awardees').deleteOne({ _id: oid });
    if (!r.deletedCount) return res.status(404).json({ success: false, error: 'Awardee not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('[awardees] DELETE (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to delete awardee' });
  }
});

module.exports = router;