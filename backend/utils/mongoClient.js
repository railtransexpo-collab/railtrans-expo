// utils/mongoClient.js
// Lightweight Mongo helper with singleton connection + counter helpers.
//
// Exports:
// - connect(uri, dbName)
// - getDb()
// - getCollection(name)
// - getNextSequence(sequenceName)
// - resetSequence(sequenceName, value)
// - isConnected()
// - close()
const { MongoClient } = require("mongodb");

let _client = null;
let _db = null;

/**
 * connect(uri, dbName, opts?)
 * - idempotent: returns existing connection if already connected
 */
async function connect(uri, dbName, opts = {}) {
  if (_client && _db) return { client: _client, db: _db };

  if (!uri) throw new Error("Mongo URI is required to connect");
  if (!dbName) throw new Error("Mongo DB name is required to connect");

  // sensible defaults; you can override via opts
  const defaultOpts = {
    // serverSelectionTimeoutMS: 5000,
    // connectTimeoutMS: 10000,
    // useUnifiedTopology and useNewUrlParser are defaults in modern drivers
    ...opts,
  };

  _client = new MongoClient(uri, defaultOpts);
  await _client.connect();
  _db = _client.db(dbName);
  return { client: _client, db: _db };
}

function getDb() {
  if (!_db) throw new Error("MongoDB not connected. Call connect(uri, dbName) first.");
  return _db;
}

function getCollection(name) {
  return getDb().collection(name);
}

function isConnected() {
  return !!(_client && _client.topology && _client.topology.isConnected && _client.topology.isConnected());
}

/**
 * getNextSequence(sequenceName)
 * - Uses a 'counters' collection to emulate auto-increment numeric ids.
 * - Returns the incremented numeric value (Number).
 */
async function getNextSequence(sequenceName) {
  if (!sequenceName) throw new Error("sequenceName is required");
  const col = getCollection("counters");
  const r = await col.findOneAndUpdate(
    { _id: sequenceName },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after" }
  );
  return r.value.seq;
}

/**
 * resetSequence(sequenceName, value)
 * - Sets the sequence to the given numeric value (upserts).
 */
async function resetSequence(sequenceName, value) {
  if (!sequenceName) throw new Error("sequenceName is required");
  const col = getCollection("counters");
  await col.updateOne({ _id: sequenceName }, { $set: { seq: Number(value) } }, { upsert: true });
  return { ok: true, sequence: sequenceName, seq: Number(value) };
}

async function close() {
  try {
    if (_client) {
      await _client.close(true);
    }
  } finally {
    _client = null;
    _db = null;
  }
}

module.exports = {
  connect,
  getDb,
  getCollection,
  getNextSequence,
  resetSequence,
  isConnected,
  close,
};