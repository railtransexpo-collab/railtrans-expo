const express = require("express");
const router = express.Router();
const multer = require("multer");
const { GridFSBucket, ObjectId } = require("mongodb");
const path = require("path");
const mongo = require("../utils/mongoClient"); // should expose getDb()

// Use memory storage (we stream the buffer into GridFS)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 300 * 1024 * 1024, // 300 MB
  },
});

/**
 * Helper: get GridFSBucket instance
 */
function getBucket(db) {
  return new GridFSBucket(db, { bucketName: "uploads" });
}

/**
 * Helper: obtain db instance from utils/mongoClient
 * Supports either:
 *  - mongo.getDb() => Promise<Db>
 *  - mongo.db (already a Db)
 */
async function obtainDb() {
  if (!mongo) return null;
  if (typeof mongo.getDb === "function") {
    const db = await mongo.getDb();
    return db;
  }
  if (mongo.db) return mongo.db;
  return null;
}

/**
 * Allowed mime types / extensions guard (soft — GridFS will still accept buffers)
 * Adjust as needed for your use-case.
 */
function isAllowedMime(mimetype, originalname) {
  if (!mimetype && !originalname) return false;
  const mime = (mimetype || "").toLowerCase();
  const ext = (path.extname(originalname || "") || "").toLowerCase();

  const allowedMimes = new Set([
    "image/jpeg","image/jpg","image/png","image/gif","image/webp",
    "video/mp4","video/webm","video/ogg","video/quicktime","video/x-matroska",
    "application/pdf","text/plain","application/msword","application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ]);
  const allowedExt = new Set([
    ".jpg",".jpeg",".png",".gif",".webp",
    ".mp4",".webm",".ogg",".mov",".mkv",
    ".pdf",".txt",".doc",".docx"
  ]);

  if (mime && allowedMimes.has(mime)) return true;
  if (ext && allowedExt.has(ext)) return true;
  return false;
}

/**
 * POST /api/upload-asset
 * POST /api/upload-file
 *
 * Expects multipart/form-data with field "file".
 * Stores file in GridFS and returns JSON with url and id.
 */
async function handleUpload(req, res) {
  try {
    // multer places the file buffer in req.file
    if (!req.file)
      return res.status(400).json({ success: false, error: "no file uploaded or file rejected (size/type)" });

    // optional: basic mime/extension whitelist check
    if (!isAllowedMime(req.file.mimetype, req.file.originalname)) {
      return res.status(400).json({ success: false, error: "unsupported file type" });
    }

    // get db (utils/mongoClient should expose getDb())
    const db = await obtainDb();
    if (!db) return res.status(500).json({ success: false, error: "database not available" });

    const bucket = getBucket(db);

    // Choose a safe filename (preserve extension from original name if present)
    const original = req.file.originalname || `upload-${Date.now()}`;
    const filename = original;

    // Open upload stream and write buffer
    const uploadStream = bucket.openUploadStream(filename, {
      metadata: {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
      },
      contentType: req.file.mimetype || "application/octet-stream",
    });

    // Write buffer and close stream
    uploadStream.end(req.file.buffer);

    // Handle stream errors once
    let responded = false;
    uploadStream.on("error", (err) => {
      if (responded) return;
      responded = true;
      console.error("[upload-mongo] uploadStream error:", err && (err.stack || err));
      return res.status(500).json({ success: false, error: "upload failed", detail: String(err && err.message ? err.message : err) });
    });

    uploadStream.on("finish", () => {
      if (responded) return;
      responded = true;
      // stream.id is an ObjectId
      const fileId = uploadStream.id && uploadStream.id.toString ? uploadStream.id.toString() : String(uploadStream.id);
      // Public URL to fetch the file via this router
      const publicUrl = `/api/uploads/mongo/${fileId}`;
      return res.json({ success: true, url: publicUrl, id: fileId, filename: filename });
    });
  } catch (err) {
    console.error("[upload-mongo] handler error:", err && (err.stack || err));
    return res.status(500).json({ success: false, error: "server error", detail: String(err && err.message ? err.message : err) });
  }
}

router.post("/upload-asset", upload.single("file"), handleUpload);
router.post("/upload-file", upload.single("file"), handleUpload);

/**
 * GET /api/uploads/mongo/:id
 * Streams the file from GridFS back to the client.
 * Example returned url from upload: /api/uploads/mongo/<id>
 */
router.get("/uploads/mongo/:id", async (req, res) => {
  const id = req.params.id;
  if (!id) return res.status(400).send("missing id");

  let oid;
  try {
    oid = new ObjectId(id);
  } catch (e) {
    return res.status(400).send("invalid id");
  }

  try {
    const db = await obtainDb();
    if (!db) return res.status(500).send("database not available");

    const filesColl = db.collection("uploads.files");
    const fileDoc = await filesColl.findOne({ _id: oid });
    if (!fileDoc) return res.status(404).send("file not found");

    // Set headers
    const contentType = fileDoc.contentType || (fileDoc.metadata && fileDoc.metadata.mimetype) || "application/octet-stream";
    res.setHeader("Content-Type", contentType);

    // Suggest filename for downloads
    const originalName = (fileDoc.metadata && fileDoc.metadata.originalname) || fileDoc.filename || `file-${id}`;
    res.setHeader("Content-Disposition", `inline; filename="${String(originalName).replace(/"/g, "'")}"`);

    const bucket = getBucket(db);
    const downloadStream = bucket.openDownloadStream(oid);

    downloadStream.on("error", (err) => {
      console.error("[upload-mongo] download error:", err && (err.stack || err));
      if (!res.headersSent) return res.status(500).end("download error");
      return res.end();
    });

    // Pipe the GridFS stream to response
    downloadStream.pipe(res);
  } catch (err) {
    console.error("[upload-mongo] GET error:", err && (err.stack || err));
    return res.status(500).send("server error");
  }
});

module.exports = router;