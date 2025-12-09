require('dotenv').config();
console.log('[TEST] dotenv loaded');

const express = require('express');
const cors = require('cors');
console.log('[TEST] express & cors loaded');

const app = express();
console.log('[TEST] app created');

app.use(express.json({ limit: '20mb' }));
console.log('[TEST] json middleware added');

const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const envOrigins = (process.env.ALLOWED_ORIGINS || process.env.REACT_APP_API_BASE_URL || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultOrigins, ...envOrigins])];
console.log('[TEST] Origins configured:', allowedOrigins);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (process.env.NODE_ENV !== 'production') return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error('Not allowed by CORS'), false);
  },
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization', 'ngrok-skip-browser-warning'],
}));
console.log('[TEST] CORS middleware added');

app.options('*', cors());
console.log('[TEST] OPTIONS middleware added');

app.get('/health', (req, res) => res.json({ ok: true }));
console.log('[TEST] health route added');

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`[TEST] Server listening on ${PORT}`);
});
