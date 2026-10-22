'use strict';

require('dotenv').config();

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scryptAsync = promisify(crypto.scrypt);
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const app = express();
const PORT = Number(process.env.PORT || 3000);
const APP_URL = (process.env.APP_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const SESSION_SECRET = process.env.SESSION_SECRET || 'development-only-change-me';
const DB_PATH = path.resolve(process.env.DB_PATH || './data/ars-store.sqlite');
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
if (SESSION_SECRET === 'development-only-change-me') {
  console.warn('[security] Set SESSION_SECRET in .env before deployment.');
}
if (IS_PRODUCTION && !APP_URL.startsWith('https://')) {
  console.warn('[security] Production APP_URL should use HTTPS.');
}

app.disable('x-powered-by');
if (IS_PRODUCTION) app.set('trust proxy', 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", 'data:', 'https://lh3.googleusercontent.com'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      connectSrc: ["'self'"],
      formAction: ["'self'"]
    }
  }
}));
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_sub TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    picture TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    email TEXT NOT NULL,
    whatsapp TEXT NOT NULL,
    product_id TEXT NOT NULL,
    price_bdt INTEGER NOT NULL,
    payment_amount TEXT NOT NULL,
    payment_currency TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    binance_prepay_id TEXT,
    checkout_url TEXT,
    payment_method TEXT NOT NULL DEFAULT 'legacy',
    bdpayhub_payment_id TEXT,
    bdpayhub_amount_minor INTEGER,
    bdpayhub_mode TEXT,
    payment_verification_source TEXT,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    paid_at TEXT,
    fulfilled_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

  CREATE TABLE IF NOT EXISTS password_credentials (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );


  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
  CREATE TABLE IF NOT EXISTS bdpayhub_webhook_events (
    event_id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL,
    received_at TEXT NOT NULL
  );
`);

// Additive migrations preserve the existing Railway SQLite volume and order history.
function ensureColumn(table, column, declaration) {
  const columns = db.pragma(`table_info(${table})`);
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  }
}
ensureColumn('orders', 'payment_method', "TEXT NOT NULL DEFAULT 'legacy'");
ensureColumn('orders', 'bdpayhub_payment_id', 'TEXT');
ensureColumn('orders', 'bdpayhub_amount_minor', 'INTEGER');
ensureColumn('orders', 'bdpayhub_mode', 'TEXT');
ensureColumn('orders', 'payment_verification_source', 'TEXT');
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_bdpayhub_payment_id ON orders(bdpayhub_payment_id) WHERE bdpayhub_payment_id IS NOT NULL");

class SQLiteSessionStore extends session.Store {
  get(sid, callback) {
    try {
      const row = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?').get(sid);
      if (!row || row.expire <= Date.now()) {
        if (row) db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        return callback(null, null);
      }
      return callback(null, JSON.parse(row.sess));
    } catch (error) {
      return callback(error);
    }
  }
  set(sid, sess, callback) {
    try {
      const expiry = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + Number((sess.cookie && sess.cookie.maxAge) || 7 * 24 * 60 * 60 * 1000);
      db.prepare(`
        INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
        ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
      `).run(sid, JSON.stringify(sess), expiry);
      if (callback) callback(null);
    } catch (error) {
      if (callback) callback(error);
    }
  }
  destroy(sid, callback) {
    try {
      db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
      if (callback) callback(null);
    } catch (error) {
      if (callback) callback(error);
    }
  }
  touch(sid, sess, callback) {
    try {
      const expiry = sess.cookie && sess.cookie.expires
        ? new Date(sess.cookie.expires).getTime()
        : Date.now() + Number((sess.cookie && sess.cookie.maxAge) || 7 * 24 * 60 * 60 * 1000);
      db.prepare('UPDATE sessions SET expire = ?, sess = ? WHERE sid = ?')
        .run(expiry, JSON.stringify(sess), sid);
      if (callback) callback(null);
    } catch (error) {
      if (callback) callback(error);
    }
  }
}
app.use(session({
  name: 'ars.sid',
  secret: SESSION_SECRET,
  store: new SQLiteSessionStore(),
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: {
    httpOnly: true,
    secure: IS_PRODUCTION,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

const registerLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
// Preserve the exact request body for BDPayHub HMAC signature verification.
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/bdpayhub/webhook') return next();
  return express.json({ limit: '10kb' })(req, res, next);
});

function nowIso() {
  return new Date().toISOString();
}
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}
function validEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scryptAsync(password, salt, 64);
  return `scrypt$${salt}$${Buffer.from(derived).toString('hex')}`;
}
async function verifyPassword(password, encoded) {
  try {
    const [scheme, salt, storedHex] = String(encoded || '').split('$');
    if (scheme !== 'scrypt' || !salt || !/^[a-f0-9]{32}$/i.test(salt) ||
        !storedHex || !/^[a-f0-9]{128}$/i.test(storedHex)) return false;
    const derived = Buffer.from(await scryptAsync(password, salt, 64));
    const stored = Buffer.from(storedHex, 'hex');
    return stored.length === derived.length && crypto.timingSafeEqual(stored, derived);
  } catch {
    return false;
  }
}
function establishUserSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => {
      if (error) return reject(error);
      req.session.user = {
        id: user.id,
        email: user.email,
        name: user.name || '',
        picture: user.picture || ''
      };
      req.session.save((saveError) => saveError ? reject(saveError) : resolve());
    });
  });
}

function getBdpayHubConfig(method) {
  if (!['bkash', 'nagad'].includes(method)) return null;
  const baseUrl = String(process.env.BDPAYHUB_BASE_URL || '').trim().replace(/\/+$/, '');
  const prefix = method === 'bkash' ? 'BDPAYHUB_BKASH' : 'BDPAYHUB_NAGAD';
  const apiKey = String(process.env[`${prefix}_API_KEY`] || '').trim();
  const webhookSecret = String(process.env[`${prefix}_WEBHOOK_SECRET`] || '').trim();
  const mode = String(process.env.BDPAYHUB_MODE || 'sandbox').trim().toLowerCase();
  let validBase = false;
  try {
    const parsed = new URL(baseUrl);
    validBase = parsed.protocol === 'https:' || (!IS_PRODUCTION && ['localhost', '127.0.0.1'].includes(parsed.hostname));
  } catch {
    validBase = false;
  }
  return {
    baseUrl,
    apiKey,
    webhookSecret,
    mode: ['live', 'sandbox'].includes(mode) ? mode : 'sandbox',
    configured: validBase && apiKey.startsWith('bdp_') && webhookSecret.length >= 16
  };
}

function getPublicPaymentConfig() {
  const bkash = getBdpayHubConfig('bkash');
  const nagad = getBdpayHubConfig('nagad');
  return {
    provider: 'BDPayHub',
    configured: Boolean(bkash?.configured || nagad?.configured),
    mode: String(process.env.BDPAYHUB_MODE || 'sandbox').trim().toLowerCase() === 'live' ? 'live' : 'sandbox',
    methods: { bkash: Boolean(bkash?.configured), nagad: Boolean(nagad?.configured) }
  };
}

function createBdpayHubSignature(timestamp, body, secret) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

function normalizePhone(value) {
  const phone = String(value || '').trim().replace(/[()\s-]/g, '');
  return /^\+?[0-9]{7,15}$/.test(phone) ? phone : '';
}

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'অর্ডার করার আগে ইমেইল ও পাসওয়ার্ড দিয়ে লগইন করুন।' });
  }
  next();
}
function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_TOKEN || '';
  const supplied = req.get('x-admin-token') || '';
  if (!expected) return res.status(503).json({ error: 'ADMIN_TOKEN is not configured.' });
  if (!safeEqual(supplied, expected)) return res.status(401).json({ error: 'Admin authorization failed.' });
  next();
}
function checkSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    if (new URL(origin).origin !== new URL(APP_URL).origin) {
      return res.status(403).json({ error: 'Invalid request origin.' });
    }
  } catch {
    return res.status(403).json({ error: 'Invalid request origin.' });
  }
  next();
}
app.get('/auth', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.sendFile(path.join(PUBLIC_DIR, 'auth.html'));
});

// Compatibility redirect: any old "Google login" link that points to /auth/google
// now opens the email/password page instead.
app.get('/auth/google', (req, res) => res.redirect(302, '/auth'));

app.post('/api/auth/register', checkSameOrigin, registerLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const name = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 60) : '';

    if (!validEmail(email)) return res.status(400).json({ error: 'সঠিক ইমেইল ঠিকানা দিন।' });
    if (password.length < 10 || password.length > 128) {
      return res.status(400).json({ error: 'পাসওয়ার্ড ১০ থেকে ১২৮ অক্ষরের মধ্যে হতে হবে।' });
    }
    if (/[\u0000-\u001f\u007f]/.test(password)) {
      return res.status(400).json({ error: 'পাসওয়ার্ডে অবৈধ অক্ষর রয়েছে।' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ? LIMIT 1').get(email);
    if (existing) {
      return res.status(409).json({ error: 'এই ইমেইলে ইতিমধ্যে অ্যাকাউন্ট আছে। লগইন করুন।' });
    }

    const passwordHash = await hashPassword(password);
    const createdAt = nowIso();
    const safeName = name || email.split('@')[0].slice(0, 60);
    const createAccount = db.transaction(() => {
      const result = db.prepare(`
        INSERT INTO users (google_sub, email, name, picture, created_at)
        VALUES (?, ?, ?, '', ?)
      `).run(`local:${crypto.randomUUID()}`, email, safeName, createdAt);
      const userId = Number(result.lastInsertRowid);
      db.prepare(`
        INSERT INTO password_credentials (user_id, email, password_hash, created_at)
        VALUES (?, ?, ?, ?)
      `).run(userId, email, passwordHash, createdAt);
      return { id: userId, email, name: safeName, picture: '' };
    });
    const user = createAccount();

    await establishUserSession(req, user);
    res.status(201).json({ ok: true, user: { email: user.email, name: user.name } });
  } catch (error) {
    if (error && error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return res.status(409).json({ error: 'এই ইমেইলে ইতিমধ্যে অ্যাকাউন্ট আছে। লগইন করুন।' });
    }
    next(error);
  }
});

app.post('/api/auth/login', checkSameOrigin, loginLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!validEmail(email) || password.length < 1 || password.length > 128) {
      return res.status(400).json({ error: 'ইমেইল ও পাসওয়ার্ড সঠিকভাবে দিন।' });
    }

    const row = db.prepare(`
      SELECT u.id, u.email, u.name, u.picture, pc.password_hash
      FROM password_credentials pc
      JOIN users u ON u.id = pc.user_id
      WHERE pc.email = ?
      LIMIT 1
    `).get(email);

    if (!row || !(await verifyPassword(password, row.password_hash))) {
      return res.status(401).json({ error: 'ইমেইল অথবা পাসওয়ার্ড সঠিক নয়।' });
    }

    await establishUserSession(req, row);
    res.json({ ok: true, user: { email: row.email, name: row.name } });
  } catch (error) {
    next(error);
  }
});


app.post('/auth/logout', checkSameOrigin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('ars.sid', {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: 'lax'
    });
    res.json({ ok: true });
  });
});
app.get('/api/config', (req, res) => {
  res.json({
    storeName: 'ARS Store',
    productName: 'Gemini AI Pro',
    durationMonths: Math.max(1, Number(process.env.PRODUCT_DURATION_MONTHS || 18)),
    priceBdt: Math.max(0, Number(process.env.PRODUCT_PRICE_BDT || 350)),
    payment: getPublicPaymentConfig(),
    supportWhatsAppUrl: process.env.SUPPORT_WHATSAPP_URL || ''
  });
});

app.get('/api/me', (req, res) => {
  res.json({ user: (req.session && req.session.user) || null });
});
app.post('/api/orders', orderLimiter, checkSameOrigin, requireLogin, async (req, res) => {
  const whatsappRaw = typeof req.body?.whatsapp === 'string' ? req.body.whatsapp.trim() : '';
  const whatsapp = normalizePhone(whatsappRaw);
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';
  const paymentMethod = String(req.body?.paymentMethod || '').trim().toLowerCase();

  if (!whatsapp || whatsappRaw.length < 8 || whatsappRaw.length > 24) {
    return res.status(400).json({ error: 'সঠিক WhatsApp / মোবাইল নম্বর দিন।' });
  }
  if (!['bkash', 'nagad'].includes(paymentMethod)) {
    return res.status(400).json({ error: 'bKash অথবা Nagad পেমেন্ট পদ্ধতি বেছে নিন।' });
  }

  const gateway = getBdpayHubConfig(paymentMethod);
  if (!gateway || !gateway.configured) {
    return res.status(503).json({
      error: `${paymentMethod === 'bkash' ? 'bKash' : 'Nagad'} checkout এখনো BDPayHub Variables দিয়ে কনফিগার করা হয়নি।`
    });
  }

  const priceBdt = Math.max(1, Math.round(Number(process.env.PRODUCT_PRICE_BDT || 350)));
  const amountMinor = priceBdt * 100;
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 100 || amountMinor > 10000000) {
    return res.status(503).json({ error: 'পণ্যের মূল্য সঠিকভাবে কনফিগার করা নেই।' });
  }

  const orderId = crypto.randomBytes(12).toString('hex');
  const createdAt = nowIso();
  db.prepare(`
    INSERT INTO orders (
      id, user_id, email, whatsapp, product_id, price_bdt,
      payment_amount, payment_currency, payment_method, bdpayhub_mode, status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'BDT', ?, ?, 'pending', ?, ?, ?)
  `).run(
    orderId,
    req.session.user.id,
    req.session.user.email,
    whatsapp,
    'gemini-ai-pro',
    priceBdt,
    priceBdt.toFixed(2),
    paymentMethod,
    gateway.mode,
    note,
    createdAt,
    createdAt
  );

  const webhookUrl = `${APP_URL}/api/bdpayhub/webhook`;
  const payload = {
    amount_minor: amountMinor,
    order_id: orderId,
    mode: gateway.mode,
    customer_name: String(req.session.user.name || req.session.user.email.split('@')[0]).slice(0, 80),
    customer_email: req.session.user.email,
    customer_phone: whatsapp,
    reference: orderId,
    return_url: `${APP_URL}/payment/success?order=${encodeURIComponent(orderId)}`,
    cancel_url: `${APP_URL}/payment/cancel?order=${encodeURIComponent(orderId)}`,
    webhook_url: webhookUrl
  };

  try {
    const response = await fetch(`${gateway.baseUrl}/api/v1/payments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${gateway.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': orderId
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
      redirect: 'error'
    });
    const result = await response.json().catch(() => ({}));
    const paymentUrl = typeof result.payment_url === 'string' ? result.payment_url : '';
    let safePaymentUrl = false;
    try {
      const target = new URL(paymentUrl);
      const gatewayOrigin = new URL(gateway.baseUrl).origin;
      safePaymentUrl = target.protocol === 'https:' && target.origin === gatewayOrigin;
    } catch {
      safePaymentUrl = false;
    }

    if (!response.ok || !result.id || !safePaymentUrl ||
        Number(result.order_amount_minor) !== amountMinor ||
        Number(result.amount_minor) < amountMinor ||
        String(result.currency || '').toUpperCase() !== 'BDT' ||
        String(result.mode || '').toLowerCase() !== gateway.mode) {
      console.error('[bdpayhub-create-payment]', response.status, result.error || result.message || 'Invalid gateway response');
      db.prepare("UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(nowIso(), orderId);
      return res.status(502).json({
        error: 'BDPayHub checkout তৈরি করতে পারেনি। Gateway URL, API key, brand account ও webhook settings পরীক্ষা করুন।'
      });
    }

    db.prepare(`
      UPDATE orders
      SET bdpayhub_payment_id = ?, bdpayhub_amount_minor = ?, checkout_url = ?,
          payment_amount = ?, payment_currency = 'BDT', updated_at = ?
      WHERE id = ?
    `).run(
      String(result.id),
      Number(result.amount_minor),
      paymentUrl,
      (Number(result.amount_minor) / 100).toFixed(2),
      nowIso(),
      orderId
    );
    return res.json({ orderId, checkoutUrl: paymentUrl, paymentMethod });
  } catch (error) {
    console.error('[bdpayhub-create-payment]', error instanceof Error ? error.message : 'Gateway request failed');
    db.prepare("UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ?")
      .run(nowIso(), orderId);
    return res.status(502).json({ error: 'BDPayHub-এ সংযোগ করা যায়নি। Gateway configuration যাচাই করে আবার চেষ্টা করুন।' });
  }
});

// Verify BDPayHub's signed event before changing any order status.
app.post('/api/bdpayhub/webhook', express.raw({ type: 'application/json', limit: '100kb' }), (req, res) => {
  const timestamp = req.get('bdpayhub-timestamp') || '';
  const eventHeader = req.get('bdpayhub-event-id') || '';
  const signature = (req.get('bdpayhub-signature') || '').toLowerCase();
  if (!Buffer.isBuffer(req.body) || !timestamp || !eventHeader || !/^[a-f0-9]{64}$/.test(signature)) {
    return res.status(400).json({ error: 'Missing or invalid webhook signature data.' });
  }
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(Math.floor(Date.now() / 1000) - seconds) > 300) {
    return res.status(401).json({ error: 'Webhook timestamp is expired.' });
  }

  const rawBody = req.body.toString('utf8');
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: 'Invalid webhook JSON.' });
  }
  const eventId = String(event.event_id || '');
  const paymentId = String(event.payment_id || '');
  if (!eventId || eventId !== eventHeader || !paymentId) {
    return res.status(400).json({ error: 'Webhook event identifiers do not match.' });
  }

  let order = db.prepare(`
    SELECT id, status, price_bdt, payment_method, bdpayhub_payment_id, bdpayhub_amount_minor, bdpayhub_mode
    FROM orders WHERE bdpayhub_payment_id = ? LIMIT 1
  `).get(paymentId);
  if (!order && typeof event.order_id === 'string' && event.order_id.length <= 100) {
    order = db.prepare(`
      SELECT id, status, price_bdt, payment_method, bdpayhub_payment_id, bdpayhub_amount_minor, bdpayhub_mode
      FROM orders WHERE id = ? LIMIT 1
    `).get(event.order_id);
  }
  if (!order) return res.status(404).json({ error: 'Payment not found.' });
  if (order.bdpayhub_payment_id && order.bdpayhub_payment_id !== paymentId) {
    return res.status(409).json({ error: 'A different gateway payment is already attached to this order.' });
  }

  const gateway = getBdpayHubConfig(order.payment_method);
  if (!gateway || !gateway.webhookSecret) return res.status(503).json({ error: 'Webhook secret is not configured.' });
  const expected = createBdpayHubSignature(timestamp, rawBody, gateway.webhookSecret);
  if (!safeEqual(signature, expected.toLowerCase())) {
    return res.status(401).json({ error: 'Invalid webhook signature.' });
  }

  if (event.event !== 'payment.paid') return res.json({ ok: true, ignored: true });
  const storedMinor = Number(order.bdpayhub_amount_minor || 0);
  const eventAmountMinor = Number(event.amount_minor);
  const originalMinor = Number(event.order_amount_minor ?? (Number(order.price_bdt) * 100));
  const expectedOriginalMinor = Number(order.price_bdt) * 100;
  const receivedMinor = Number(event.received_amount_minor);
  const currency = String(event.currency || '').toUpperCase();
  const source = String(event.verification_source || '');
  const amountMatches = Number.isSafeInteger(eventAmountMinor) && eventAmountMinor >= 1 &&
    (storedMinor > 0 ? eventAmountMinor === storedMinor : eventAmountMinor >= expectedOriginalMinor);
  if (!amountMatches || !Number.isSafeInteger(originalMinor) || originalMinor !== expectedOriginalMinor ||
      currency !== 'BDT' || !Number.isSafeInteger(receivedMinor) || receivedMinor < eventAmountMinor ||
      !source || (String(order.bdpayhub_mode || gateway.mode) === 'live' && source !== 'SMS_MATCHED')) {
    console.error('[bdpayhub-webhook] Amount, currency or verification source mismatch for order', order.id);
    return res.status(400).json({ error: 'Payment amount or verification source mismatch.' });
  }

  try {
    const processEvent = db.transaction(() => {
      const existing = db.prepare('SELECT event_id FROM bdpayhub_webhook_events WHERE event_id = ?').get(eventId);
      if (existing) return 'duplicate';
      db.prepare('INSERT INTO bdpayhub_webhook_events (event_id, payment_id, received_at) VALUES (?, ?, ?)')
        .run(eventId, paymentId, nowIso());
      db.prepare(`
        UPDATE orders
        SET status = CASE WHEN status = 'fulfilled' THEN status ELSE 'paid' END,
            bdpayhub_payment_id = COALESCE(bdpayhub_payment_id, ?),
            bdpayhub_amount_minor = COALESCE(bdpayhub_amount_minor, ?),
            bdpayhub_mode = COALESCE(bdpayhub_mode, ?),
            payment_verification_source = ?,
            paid_at = COALESCE(paid_at, ?),
            updated_at = ?
        WHERE id = ? AND (bdpayhub_payment_id IS NULL OR bdpayhub_payment_id = ?)
          AND status IN ('pending', 'failed', 'paid', 'fulfilled')
      `).run(paymentId, eventAmountMinor, order.bdpayhub_mode || gateway.mode, source, nowIso(), nowIso(), order.id, paymentId);
      return 'processed';
    });
    const result = processEvent();
    return res.json({ ok: true, duplicate: result === 'duplicate' });
  } catch (error) {
    console.error('[bdpayhub-webhook]', error instanceof Error ? error.message : 'Webhook processing failed');
    return res.status(500).json({ error: 'Webhook could not be processed.' });
  }
});

app.get('/api/orders/:id', requireLogin, (req, res) => {
  const order = db.prepare(`
    SELECT id, product_id, price_bdt, payment_amount, payment_currency,
           payment_method, payment_verification_source, status, created_at, paid_at, fulfilled_at
    FROM orders WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.session.user.id);

  if (!order) return res.status(404).json({ error: 'অর্ডার পাওয়া যায়নি।' });
  res.json({ order });
});

// Download a consistent SQLite snapshot. This endpoint requires the same admin token as order management.
app.get('/api/admin/backup', requireAdmin, async (req, res, next) => {
  const tempPath = path.join(
    require('node:os').tmpdir(),
    `ars-backup-${crypto.randomBytes(12).toString('hex')}.sqlite`
  );

  try {
    await db.backup(tempPath);
    res.setHeader('Cache-Control', 'no-store');
    const filename =
      `ars-store-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`;

    res.download(tempPath, filename, (error) => {
      fs.promises.unlink(tempPath).catch(() => {});
      if (error && !res.headersSent) next(error);
    });
  } catch (error) {
    fs.promises.unlink(tempPath).catch(() => {});
    next(error);
  }
});

app.get('/api/admin/orders', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT id, email, whatsapp, product_id, price_bdt, payment_amount,
           payment_currency, payment_method, payment_verification_source, status, note, created_at, paid_at, fulfilled_at
    FROM orders
    ORDER BY created_at DESC
    LIMIT 200
  `).all();
  res.json({ orders: rows });
});
app.post('/api/admin/orders/:id/fulfill', requireAdmin, (req, res) => {
  const order = db.prepare('SELECT id, status FROM orders WHERE id = ?').get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found.' });
  if (order.status !== 'paid') {
    return res.status(409).json({ error: 'Only a verified paid order can be fulfilled.' });
  }
  db.prepare("UPDATE orders SET status = 'fulfilled', fulfilled_at = ?, updated_at = ? WHERE id = ?")
    .run(nowIso(), nowIso(), req.params.id);
  res.json({ ok: true });
});


app.get('/health', (req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.status(200).json({ status: 'ok' });
  } catch (error) {
    res.status(503).json({ status: 'error' });
  }
});

app.use(express.static(PUBLIC_DIR, {
  etag: true,
  maxAge: IS_PRODUCTION ? '1h' : 0
}));
app.get('/payment/success', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'payment.html')));
app.get('/payment/cancel', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'payment.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'admin.html')));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API route not found.' });
  res.status(404).send('Page not found.');
});
app.use((error, req, res, next) => {
  console.error('[server-error]', error.message);
  if (res.headersSent) return next(error);
  res.status(500).json({ error: 'সার্ভারে সমস্যা হয়েছে। পরে আবার চেষ্টা করুন।' });
});

app.listen(PORT, () => {
  console.log(`ARS Store running at ${APP_URL}`);
});
