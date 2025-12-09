const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const mongo = require('../utils/mongoClient'); // should expose getDb() or .db
const { sendMail } = require('../utils/mailer'); // keep existing mailer

// parse JSON bodies for all routes in this router
router.use(express.json({ limit: '5mb' }));

async function obtainDb() {
  if (!mongo) return null;
  if (typeof mongo.getDb === 'function') return await mongo.getDb();
  if (mongo.db) return mongo.db;
  return null;
}

/**
 * Helper: safe ObjectId parse
 */
function toObjectId(id) {
  try {
    return new ObjectId(String(id));
  } catch {
    return null;
  }
}

/**
 * POST /api/exhibitors/step
 * Accept step snapshots from front-end (non-blocking)
 */
router.post('/step', async (req, res) => {
  try {
    console.debug('[exhibitors] step snapshot:', req.body);
    // Optionally persist steps to a 'steps' collection - left as no-op to keep behavior light
    return res.json({ success: true });
  } catch (err) {
    console.error('[exhibitors] step error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to record step' });
  }
});

/**
 * POST /api/exhibitors
 * Create exhibitor (MongoDB implementation)
 */
router.post('/', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });
    const col = db.collection('exhibitors');

    const body = req.body || {};
    console.info('[exhibitors] create payload keys:', Object.keys(body).length ? Object.keys(body) : '(empty)');

    // helper to pick first available key from list (case-insensitive fallback)
    const pick = (keys = []) => {
      for (const k of keys) {
        if (Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== '') {
          return String(body[k]).trim();
        }
      }
      for (const bk of Object.keys(body)) {
        for (const k of keys) {
          if (bk.toLowerCase() === String(k).toLowerCase() && body[bk] !== undefined && body[bk] !== null && String(body[bk]).trim() !== '') {
            return String(body[bk]).trim();
          }
        }
      }
      return '';
    };

    const companyVal = pick(['companyName', 'company', 'company_name', 'companyname', 'organization', 'org']);
    const otherVal = pick(['other', 'other_company', 'otherCompany']);

    if (!companyVal && !otherVal) {
      return res.status(400).json({ success: false, error: 'companyName is required', message: 'Provide companyName or other' });
    }

    // Map allowed input fields to document keys
    const FIELD_MAP = {
      surname: 'surname',
      name: 'name',
      email: 'email',
      mobile: 'mobile',
      designation: 'designation',
      category: 'category',
      spaceType: 'space_type',
      space_size: 'space_size',
      boothType: 'boothType',
      productDetails: 'productDetails',
      notes: 'notes',
      address: 'address'
    };

    const doc = {};
    for (const [inputKey, docKey] of Object.entries(FIELD_MAP)) {
      const val = (body[inputKey] !== undefined) ? body[inputKey] : (body[inputKey.toLowerCase()] !== undefined ? body[inputKey.toLowerCase()] : undefined);
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        doc[docKey] = (typeof val === 'object') ? JSON.stringify(val) : String(val).trim();
      }
    }

    // canonical company field
    doc.company = companyVal || '';
    if (otherVal) doc.other = otherVal;

    // status and timestamps
    doc.status = 'pending';
    doc.created_at = new Date();
    doc.updated_at = new Date();

    const insertRes = await col.insertOne(doc);
    const insertedId = insertRes && insertRes.insertedId ? String(insertRes.insertedId) : null;

    // respond immediately to client
    res.status(201).json({ success: true, insertedId, id: insertedId });

    // background tasks: send acknowledgement & admin notifications
    (async () => {
      try {
        if (!insertedId) return;
        const saved = await col.findOne({ _id: toObjectId(insertedId) });
        const to = (saved && saved.email) || body.email || null;
        if (to) {
          const name = (saved && (saved.name || saved.company)) || companyVal || '';
          const subject = 'RailTrans Expo — We received your exhibitor request';
          const text = `Hello ${name},

Thank you for your exhibitor request. We have received your details and our team will get back to you soon.

Regards,
RailTrans Expo Team`;
          const html = `<p>Hello ${name},</p><p>Thank you for your exhibitor request. We have received your details and our team will get back to you soon.</p><p>Regards,<br/>RailTrans Expo Team</p>`;
          try {
            await sendMail({ to, subject, text, html });
            console.debug('[exhibitors] ack email sent to', to);
          } catch (e) {
            console.error('[exhibitors] ack email failed:', e && (e.message || e));
          }
        }

        const adminEnv = (process.env.EXHIBITOR_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '');
        const adminList = adminEnv.split(',').map(s => s.trim()).filter(Boolean);
        if (adminList.length) {
          const subject = `New exhibitor registration — ID: ${insertedId}`;
          const html = `<p>New exhibitor registered.</p><pre>${JSON.stringify(saved || body, null, 2)}</pre>`;
          const text = `New exhibitor\n${JSON.stringify(saved || body, null, 2)}`;
          await Promise.all(adminList.map(async (addr) => {
            try {
              await sendMail({ to: addr, subject, text, html });
            } catch (e) {
              console.error('[exhibitors] admin notify error to', addr, e && (e.message || e));
            }
          }));
        } else {
          console.debug('[exhibitors] no admin emails configured');
        }
      } catch (e) {
        console.error('[exhibitors] background email error:', e && (e.stack || e));
      }
    })();

    return;
  } catch (err) {
    console.error('[exhibitors] register error (mongo):', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Server error registering exhibitor', detail: err && err.message ? err.message : String(err) });
  }
});

/**
 * POST /api/exhibitors/notify
 * Notify exhibitor and admins
 */
router.post('/notify', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });
    const col = db.collection('exhibitors');

    const { exhibitorId, form } = req.body || {};
    let exhibitor = null;
    if (exhibitorId) {
      const oid = toObjectId(exhibitorId);
      if (!oid) return res.status(400).json({ success: false, error: 'invalid exhibitorId' });
      exhibitor = await col.findOne({ _id: oid });
    } else if (form) exhibitor = form;

    if (!exhibitor) return res.status(400).json({ success: false, error: 'exhibitorId or form required' });

    const to = exhibitor.email || exhibitor.contactEmail || exhibitor.emailAddress;
    const subject = 'RailTrans Expo — Notification';
    const text = `Hello,\n\nThis is a notification regarding your exhibitor registration.\n\nRegards,\nRailTrans Expo Team`;
    const html = `<p>Hello,</p><p>This is a notification regarding your exhibitor registration.</p>`;

    const results = { partnerMail: null, adminResults: [] };

    if (to) {
      try {
        const r = await sendMail({ to, subject, text, html });
        results.partnerMail = { to, result: r };
      } catch (e) {
        results.partnerMail = { to, error: e && (e.message || String(e)) };
      }
    }

    const adminEnv = (process.env.EXHIBITOR_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '');
    const adminList = adminEnv.split(',').map(s => s.trim()).filter(Boolean);
    for (const addr of adminList) {
      try {
        const r = await sendMail({ to: addr, subject: `Exhibitor notify — ${exhibitorId || ''}`, text: `Exhibitor\n${JSON.stringify(exhibitor, null, 2)}`, html: `<pre>${JSON.stringify(exhibitor, null, 2)}</pre>` });
        results.adminResults.push({ to: addr, result: r });
      } catch (e) {
        results.adminResults.push({ to: addr, error: e && (e.message || String(e)) });
      }
    }

    return res.json({ success: true, results });
  } catch (err) {
    console.error('[exhibitors] notify error (mongo):', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Server error sending notifications', detail: err && err.message ? err.message : String(err) });
  }
});

/* ---------- Read / Update / Delete ---------- */

/**
 * GET /api/exhibitors
 */
router.get('/', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ error: 'database not available' });
    const col = db.collection('exhibitors');
    const rows = await col.find({}).sort({ created_at: -1 }).limit(2000).toArray();
    const out = rows.map(r => {
      const copy = { ...r };
      if (copy._id) { copy.id = String(copy._id); delete copy._id; }
      return copy;
    });
    return res.json(out);
  } catch (err) {
    console.error('Fetch exhibitors (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ error: 'Failed to fetch exhibitors' });
  }
});

/**
 * GET /api/exhibitors/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ error: 'database not available' });
    const oid = toObjectId(req.params.id);
    if (!oid) return res.status(400).json({ error: 'invalid id' });
    const col = db.collection('exhibitors');
    const doc = await col.findOne({ _id: oid });
    if (!doc) return res.status(404).json({});
    const copy = { ...doc };
    if (copy._id) { copy.id = String(copy._id); delete copy._id; }
    return res.json(copy);
  } catch (err) {
    console.error('Fetch exhibitor (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ error: 'Failed to fetch exhibitor' });
  }
});

/**
 * PUT /api/exhibitors/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });
    const oid = toObjectId(req.params.id);
    if (!oid) return res.status(400).json({ success: false, error: 'invalid id' });

    const fields = { ...(req.body || {}) };
    delete fields.id;
    if (Object.keys(fields).length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });

    // flatten objects to JSON strings where necessary
    const update = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== null && typeof v === 'object') update[k] = JSON.stringify(v);
      else update[k] = v;
    }
    update.updated_at = new Date();

    const col = db.collection('exhibitors');
    const r = await col.updateOne({ _id: oid }, { $set: update });
    if (r.matchedCount === 0) return res.status(404).json({ success: false, error: 'Exhibitor not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('Exhibitor update (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to update exhibitor' });
  }
});

/**
 * DELETE /api/exhibitors/:id
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });
    const oid = toObjectId(req.params.id);
    if (!oid) return res.status(400).json({ success: false, error: 'invalid id' });
    const col = db.collection('exhibitors');
    const r = await col.deleteOne({ _id: oid });
    if (r.deletedCount === 0) return res.status(404).json({ success: false, error: 'Exhibitor not found' });
    return res.json({ success: true });
  } catch (err) {
    console.error('Exhibitor delete (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: 'Failed to delete exhibitor' });
  }
});

/* ---------- Approve / Cancel ---------- */

/**
 * POST /api/exhibitors/:id/approve
 */
router.post('/:id/approve', async (req, res) => {
  const id = req.params.id;
  const admin = req.body && req.body.admin ? String(req.body.admin) : 'web-admin';
  if (!id) return res.status(400).json({ success: false, error: 'Missing id' });

  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });
    const col = db.collection('exhibitors');

    const oid = toObjectId(id);
    if (!oid) return res.status(400).json({ success: false, error: 'invalid id' });

    const updateDoc = { status: 'approved', updated_at: new Date(), approved_by: admin, approved_at: new Date() };

    const r = await col.updateOne({ _id: oid }, { $set: updateDoc });
    if (r.matchedCount === 0) return res.status(404).json({ success: false, error: 'Exhibitor not found' });

    const updated = await col.findOne({ _id: oid });
    const copy = { ...updated };
    if (copy._id) { copy.id = String(copy._id); delete copy._id; }

    // respond quickly
    res.json({ success: true, id, updated: copy });

    // send email to exhibitor (background)
    if (updated && updated.email) {
      (async () => {
        try {
          const to = updated.email;
          const name = updated.name || updated.company || '';
          const subject = `Your exhibitor request has been approved — RailTrans Expo`;
          const text = `Hello ${name},\n\nYour exhibitor registration (ID: ${updated._id}) has been approved.\n\nRegards,\nRailTrans Expo Team`;
          const html = `<p>Hello ${name},</p><p>Your exhibitor registration (ID: <strong>${updated._id}</strong>) has been <strong>approved</strong>.</p>`;
          await sendMail({ to, subject, text, html });
        } catch (e) {
          console.error('[exhibitors] approval email error:', e && (e.stack || e));
        }
      })();
    }

    // notify admins (background)
    (async () => {
      try {
        const adminEnv = (process.env.EXHIBITOR_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '');
        const toAddrs = adminEnv.split(',').map(s => s.trim()).filter(Boolean);
        if (!toAddrs.length) return;
        const subject = `Exhibitor approved — ID: ${updated ? updated._id : id}`;
        const text = `Exhibitor approved\nID: ${updated ? updated._id : id}\nName: ${updated ? updated.name || updated.company || '' : ''}\nEmail: ${updated ? updated.email : ''}`;
        const html = `<p>Exhibitor approved</p><pre>${JSON.stringify(updated || {}, null, 2)}</pre>`;
        await Promise.all(toAddrs.map(addr => sendMail({ to: addr, subject, text, html }).catch(e => console.error('[exhibitors] admin email error:', addr, e && (e.message || e)))));
      } catch (e) {
        console.error('[exhibitors] admin notify error:', e && (e.stack || e));
      }
    })();

    return;
  } catch (err) {
    console.error('Approve exhibitor (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Server error approving exhibitor' });
  }
});

/**
 * POST /api/exhibitors/:id/cancel
 */
router.post('/:id/cancel', async (req, res) => {
  const id = req.params.id;
  const admin = req.body && req.body.admin ? String(req.body.admin) : 'web-admin';
  if (!id) return res.status(400).json({ success: false, error: 'Missing id' });

  try {
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: 'database not available' });
    const col = db.collection('exhibitors');

    const oid = toObjectId(id);
    if (!oid) return res.status(400).json({ success: false, error: 'invalid id' });

    const updateDoc = { status: 'cancelled', updated_at: new Date(), cancelled_by: admin, cancelled_at: new Date() };

    const r = await col.updateOne({ _id: oid }, { $set: updateDoc });
    if (r.matchedCount === 0) return res.status(404).json({ success: false, error: 'Exhibitor not found' });

    const updated = await col.findOne({ _id: oid });
    const copy = { ...updated };
    if (copy._id) { copy.id = String(copy._id); delete copy._id; }

    res.json({ success: true, id, updated: copy });

    // email exhibitor (background)
    if (updated && updated.email) {
      (async () => {
        try {
          const to = updated.email;
          const name = updated.name || updated.company || '';
          const subject = `Your exhibitor registration has been cancelled — RailTrans Expo`;
          const text = `Hello ${name},\n\nYour exhibitor registration (ID: ${updated._id}) has been cancelled.\n\nRegards,\nRailTrans Expo Team`;
          const html = `<p>Hello ${name},</p><p>Your exhibitor registration (ID: <strong>${updated._id}</strong>) has been cancelled.</p>`;
          await sendMail({ to, subject, text, html });
        } catch (e) {
          console.error('[exhibitors] cancel email error:', e && (e.stack || e));
        }
      })();
    }

    // notify admins (background)
    (async () => {
      try {
        const adminEnv = (process.env.EXHIBITOR_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '');
        const toAddrs = adminEnv.split(',').map(s => s.trim()).filter(Boolean);
        if (!toAddrs.length) return;
        const subject = `Exhibitor cancelled — ID: ${updated ? updated._id : id}`;
        const text = `Exhibitor cancelled\nID: ${updated ? updated._id : id}\nName: ${updated ? updated.name || updated.company || '' : ''}\nEmail: ${updated ? updated.email : ''}`;
        const html = `<p>Exhibitor cancelled</p><pre>${JSON.stringify(updated || {}, null, 2)}</pre>`;
        await Promise.all(toAddrs.map(addr => sendMail({ to: addr, subject, text, html }).catch(e => console.error('[exhibitors] admin cancel notify error:', addr, e && (e.message || e)))));
      } catch (e) {
        console.error('[exhibitors] admin cancel notify error:', e && (e.stack || e));
      }
    })();

    return;
  } catch (err) {
    console.error('Cancel exhibitor (mongo) error:', err && (err.stack || err));
    return res.status(500).json({ success: false, error: err && err.message ? err.message : 'Server error cancelling exhibitor' });
  }
});

module.exports = router;