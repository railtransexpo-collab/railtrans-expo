const { MongoClient } = require("mongodb");

let _client = null;
let _db = null;

async function connect(uri, dbName) {
  if (_client && _db) return { client: _client, db: _db };
  _client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true });
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

/**
 * getNextSequence(sequenceName)
 * - Uses a 'counters' collection to emulate auto-increment numeric ids.
 * - Returns the incremented numeric value (Number).
 */
async function getNextSequence(sequenceName) {
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
  const col = getCollection("counters");
  await col.updateOne({ _id: sequenceName }, { $set: { seq: Number(value) } }, { upsert: true });
  return { ok: true, sequence: sequenceName, seq: Number(value) };
}

module.exports = { connect, getDb, getCollection, getNextSequence, resetSequence };