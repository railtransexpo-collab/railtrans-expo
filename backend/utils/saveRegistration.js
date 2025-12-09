const mongo = require('./mongoClient');
const { safeFieldName } = require('./mongoSchemaSync'); // re-use the same normalization

async function obtainDb() {
  if (!mongo) throw new Error('mongoClient not available');
  if (typeof mongo.getDb === 'function') return await mongo.getDb();
  if (mongo.db) return mongo.db;
  throw new Error('mongoClient has no getDb/db');
}

/**
 * mapFormToDoc(form, allowedFields)
 * - form: object (raw submitted form)
 * - allowedFields: optional array of admin field objects (with .name) to whitelist only fields admin configured
 *
 * Returns an object with mapped normalized field names and _rawForm preserved.
 */
function mapFormToDoc(form = {}, allowedFields = null) {
  const doc = {};
  const raw = form || {};

  // build whitelist set of safe names if allowedFields provided
  let whitelist = null;
  if (Array.isArray(allowedFields)) {
    whitelist = new Set(
      allowedFields
        .map(f => (f && f.name ? safeFieldName(f.name) : null))
        .filter(Boolean)
    );
  }

  for (const [k, v] of Object.entries(raw)) {
    if (k === '_rawForm') continue;
    const safe = safeFieldName(k);
    if (!safe) continue;
    // if whitelist exists, skip fields not in it
    if (whitelist && !whitelist.has(safe)) continue;
    // store value as-is (you may sanitize/coerce here)
    doc[safe] = v === undefined ? null : v;
  }

  // Also coerce nested _rawForm keys (if front-end already provided nested)
  // but avoid overwriting mapped keys
  if (raw._rawForm && typeof raw._rawForm === 'object') {
    for (const [k, v] of Object.entries(raw._rawForm || {})) {
      const safe = safeFieldName(k);
      if (!safe) continue;
      if (doc[safe] === undefined) {
        if (whitelist && !whitelist.has(safe)) continue;
        doc[safe] = v === undefined ? null : v;
      }
    }
  }

  // Attach the raw payload for later debugging / email templates / admin
  doc._rawForm = raw;
  return doc;
}

/**
 * saveRegistration(collectionName, form, options)
 * - collectionName: e.g. 'visitors', 'exhibitors', 'partners', 'awardees', 'speakers'
 * - form: object submitted from front-end
 * - options: { allowedFields: array } optional admin fields (use to whitelist)
 *
 * Returns { insertedId, doc } where insertedId is String(ObjectId)
 */
async function saveRegistration(collectionName, form = {}, options = {}) {
  if (!collectionName) throw new Error('collectionName required');
  const db = await obtainDb();
  const col = db.collection(collectionName);

  const allowedFields = Array.isArray(options.allowedFields) ? options.allowedFields : null;
  const docToSave = mapFormToDoc(form, allowedFields);

  const now = new Date();
  docToSave.createdAt = now;
  docToSave.updatedAt = now;

  const r = await col.insertOne(docToSave);
  const insertedId = r && r.insertedId ? String(r.insertedId) : null;
  return { insertedId, doc: docToSave };
}

module.exports = { saveRegistration, mapFormToDoc };