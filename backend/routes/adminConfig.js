const express = require('express');
const router = express.Router();
const { ObjectId } = require('mongodb');
const mongo = require('../utils/mongoClient'); // must expose getDb()

// helper: build absolute file URL (same semantics as your existing code)
function absoluteFileUrl(req, filePath) {
  const proto = req.get('x-forwarded-proto') || req.protocol;
  const host = req.get('x-forwarded-host') || req.get('host');
  return `${proto}://${host}${filePath}`;
}

// GET /api/admin-config
router.get('/admin-config', async (req, res) => {
  try {
    const db = mongo.getDb();
    const col = db.collection('admin_settings');
    const row = await col.findOne({}, { projection: { logo_url: 1, primary_color: 1, updated_at: 1 } });
    if (!row) return res.json({});
    return res.json({
      logoUrl: row.logo_url || '',
      primaryColor: row.primary_color || '',
      updatedAt: row.updated_at || row.updatedAt || null,
    });
  } catch (err) {
    console.error('GET /admin-config (mongo) error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// PUT /api/admin-config
router.put('/admin-config', express.json(), async (req, res) => {
  const { logoUrl, primaryColor } = req.body || {};
  try {
    const db = mongo.getDb();
    const col = db.collection('admin_settings');
    const update = {
      $set: {
        logo_url: logoUrl || null,
        primary_color: primaryColor || null,
        updated_at: new Date(),
      },
      $setOnInsert: { created_at: new Date() },
    };
    const result = await col.findOneAndUpdate({}, update, { upsert: true, returnDocument: 'after' });
    const out = result.value || {};
    return res.json({
      success: true,
      logoUrl: out.logo_url || null,
      primaryColor: out.primary_color || null,
      updatedAt: out.updated_at || out.updatedAt || null,
    });
  } catch (err) {
    console.error('PUT /admin-config (mongo) error:', err);
    return res.status(500).json({ error: 'server error' });
  }
});

// GET /api/admin/logo-url
router.get('/admin/logo-url', async (req, res) => {
  try {
    const db = mongo.getDb();
    const col = db.collection('admin_settings');
    const row = await col.findOne({}, { projection: { logo_url: 1 } });
    const stored = row ? (row.logo_url || '') : '';
    let absoluteUrl = '';
    if (stored) {
      if (/^https?:\/\//i.test(stored)) absoluteUrl = stored;
      else if (stored.startsWith('/')) {
        absoluteUrl = absoluteFileUrl(req, stored);
      } else {
        absoluteUrl = absoluteFileUrl(req, `/${stored.replace(/^\/+/, '')}`);
      }
    }
    return res.json({ logo_url: absoluteUrl, logoUrl: absoluteUrl, url: absoluteUrl });
  } catch (err) {
    console.error('GET /admin/logo-url (mongo) error:', err);
    return res.json({ logo_url: '', logoUrl: '', url: '' });
  }
});

// POST /api/admin-config/upload (file handling kept in server; this route expects upload middleware)
// multer middleware in server should populate req.file
router.post('/admin-config/upload', async (req, res) => {
  // If you need the upload logic inside this router, require multer here and replicate
  try {
    if (!req.file) return res.status(400).json({ error: 'no file uploaded or file rejected (size/type)' });
    const fileUrlPath = `/uploads/${req.file.filename}`;
    const publicUrl = absoluteFileUrl(req, fileUrlPath);

    // persist URL to Mongo
    try {
      const db = mongo.getDb();
      const col = db.collection('admin_settings');
      const update = { $set: { logo_url: publicUrl, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } };
      await col.updateOne({}, update, { upsert: true });
    } catch (dbErr) {
      console.warn('Failed to persist admin_settings logo_url to Mongo (but upload succeeded):', dbErr);
    }

    return res.json({ success: true, url: publicUrl });
  } catch (err) {
    console.error('Upload handler (mongo) error:', err);
    return res.status(500).json({ error: err.message || 'server error' });
  }
});

module.exports = router;