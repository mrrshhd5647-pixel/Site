'use strict';

require('dotenv').config();

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const Database = require('better-sqlite3');
const { OAuth2Client } = require('google-auth-library');
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
      formAction: ["'self'", 'https://accounts.google.com']
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
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    paid_at TEXT,
    fulfilled_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
  CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
`);
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
const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
const googleOAuth = new OAuth2Client(
  googleClientId,
  googleClientSecret,
  `${APP_URL}/auth/google/callback`
);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false
});
// Parse JSON request bodies for app APIs, but preserve the raw Binance webhook body for signature verification.
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/binance/webhook') return next();
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

function createBinanceSignature(timestamp, nonce, body, secret) {
  const payload = `${timestamp}\n${nonce}\n${body}\n`;
  return crypto.createHmac('sha512', secret).update(payload).digest('hex').toUpperCase();
}
function getPaymentSpec() {
  const fiatAmount = (process.env.BINANCE_PAY_FIAT_AMOUNT || '').trim();
  const fiatCurrency = (process.env.BINANCE_PAY_FIAT_CURRENCY || '').trim().toUpperCase();
  if (fiatAmount && fiatCurrency) {
    const n = Number(fiatAmount);
    if (!Number.isFinite(n) || n <= 0) throw new Error('BINANCE_PAY_FIAT_AMOUNT must be a positive number.');
    return { amount: String(fiatAmount), currency: fiatCurrency, mode: 'fiat', body: { fiatAmount: n, fiatCurrency } };
  }
  const orderAmount = (process.env.BINANCE_PAY_ORDER_AMOUNT || '').trim();
  const orderCurrency = (process.env.BINANCE_PAY_ORDER_CURRENCY || '').trim().toUpperCase();
  if (orderAmount && orderCurrency) {
    const n = Number(orderAmount);
    if (!Number.isFinite(n) || n <= 0) throw new Error('BINANCE_PAY_ORDER_AMOUNT must be a positive number.');
    return { amount: String(orderAmount), currency: orderCurrency, mode: 'crypto', body: { orderAmount: n, currency: orderCurrency } };
  }
  throw new Error('Configure Binance Pay fiat amount/currency or crypto amount/currency in .env.');
}

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'অর্ডার করার আগে Google দিয়ে লগইন করুন।' });
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
app.get('/auth/google', authLimiter, (req, res, next) => {
  if (!googleClientId || !googleClientSecret) {
    return res.redirect('/?notice=google-config');
  }
  const state = crypto.randomBytes(32).toString('hex');
  req.session.oauthState = state;
  const url = googleOAuth.generateAuthUrl({
    scope: ['openid', 'email', 'profile'],
    state,
    prompt: 'select_account'
  });
  req.session.save((error) => {
    if (error) return next(error);
    res.redirect(url);
  });
});
app.get('/auth/google/callback', authLimiter, async (req, res, next) => {
  try {
    if (req.query.error) return res.redirect('/?notice=auth-error');
    const { code, state } = req.query;
    const savedState = req.session.oauthState;
    delete req.session.oauthState;

    if (typeof code !== 'string' || typeof state !== 'string' || !savedState || !safeEqual(state, savedState)) {
      return res.status(400).send('Google sign-in could not be verified. Please return to ARS Store and try again.');
    }
    const { tokens } = await googleOAuth.getToken(code);
    if (!tokens.id_token) throw new Error('Google did not return an ID token.');
    const ticket = await googleOAuth.verifyIdToken({
      idToken: tokens.id_token,
      audience: googleClientId
    });
    const profile = ticket.getPayload();
    if (!profile || !profile.sub || !profile.email || profile.email_verified !== true) {
      return res.status(401).send('A verified Google email is required to sign in.');
    }
    const createdAt = nowIso();
    db.prepare(`
      INSERT INTO users (google_sub, email, name, picture, created_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(google_sub) DO UPDATE SET
        email = excluded.email,
        name = excluded.name,
        picture = excluded.picture
    `).run(
      profile.sub,
      profile.email,
      profile.name || profile.email.split('@')[0],
      profile.picture || '',
      createdAt
    );
    const row = db.prepare('SELECT id, email, name, picture FROM users WHERE google_sub = ?').get(profile.sub);
    req.session.regenerate((error) => {
      if (error) return next(error);
      req.session.user = {
        id: row.id,
        email: row.email,
        name: row.name,
        picture: row.picture
      };
      req.session.save((saveError) => {
        if (saveError) return next(saveError);
        res.redirect('/');
      });
    });
  } catch (error) {
    console.error('[google-auth]', error.message);
    res.redirect('/?notice=auth-error');
  }
});
app.post('/auth/logout', (req, res) => {
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
  let payment = { configured: false, mode: null, amount: null, currency: null };
  try {
    const spec = getPaymentSpec();
    payment = {
      configured: Boolean(process.env.BINANCE_PAY_API_KEY && process.env.BINANCE_PAY_SECRET_KEY),
      mode: spec.mode,
      amount: spec.amount,
      currency: spec.currency
    };
  } catch {
    // Public storefront remains viewable before credentials are configured.
  }
  res.json({
    storeName: 'ARS Store',
    productName: 'Gemini AI Pro',
    durationMonths: Math.max(1, Number(process.env.PRODUCT_DURATION_MONTHS || 18)),
    priceBdt: Math.max(0, Number(process.env.PRODUCT_PRICE_BDT || 350)),
    payment,
    supportWhatsAppUrl: process.env.SUPPORT_WHATSAPP_URL || ''
  });
});

app.get('/api/me', (req, res) => {
  res.json({ user: (req.session && req.session.user) || null });
});
app.post('/api/orders', orderLimiter, checkSameOrigin, requireLogin, async (req, res) => {
  const whatsapp = typeof req.body?.whatsapp === 'string' ? req.body.whatsapp.trim() : '';
  const note = typeof req.body?.note === 'string' ? req.body.note.trim().slice(0, 500) : '';

  if (whatsapp.length < 8 || whatsapp.length > 24 || !/^[+0-9()\-\s]+$/.test(whatsapp)) {
    return res.status(400).json({ error: 'সঠিক WhatsApp / মোবাইল নম্বর দিন।' });
  }
  let spec;
  try {
    spec = getPaymentSpec();
  } catch (error) {
    return res.status(503).json({
      error: 'Binance Pay এখনো কনফিগার করা হয়নি। .env ফাইলের payment settings পরীক্ষা করুন।'
    });
  }

  const apiKey = process.env.BINANCE_PAY_API_KEY || '';
  const secretKey = process.env.BINANCE_PAY_SECRET_KEY || '';
  if (!apiKey || !secretKey) {
    return res.status(503).json({ error: 'Binance Pay API credentials .env ফাইলে যোগ করা হয়নি।' });
  }
  const orderId = crypto.randomBytes(12).toString('hex');
  const createdAt = nowIso();
  const priceBdt = Math.max(0, Number(process.env.PRODUCT_PRICE_BDT || 350));
  const durationMonths = Math.max(1, Number(process.env.PRODUCT_DURATION_MONTHS || 18));
  db.prepare(`
    INSERT INTO orders (
      id, user_id, email, whatsapp, product_id, price_bdt,
      payment_amount, payment_currency, status, note, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).run(
    orderId,
    req.session.user.id,
    req.session.user.email,
    whatsapp,
    'gemini-ai-pro',
    priceBdt,
    spec.amount,
    spec.currency,
    note,
    createdAt,
    createdAt
  );
  const body = {
    env: { terminalType: 'WAP' },
    merchantTradeNo: orderId,
    description: `ARS Store Gemini AI Pro subscription - ${durationMonths} months`,
    goodsDetails: [{
      goodsType: '02',
      goodsCategory: 'Z000',
      referenceGoodsId: 'gemini-ai-pro',
      goodsName: 'Gemini AI Pro Subscription',
      goodsDetail: `${durationMonths} month digital subscription, subject to seller terms`
    }],
    buyer: {
      buyerEmail: req.session.user.email,
      buyerBrowserLanguage: 'bn'
    },
    returnUrl: `${APP_URL}/payment/success?order=${orderId}`,
    cancelUrl: `${APP_URL}/payment/cancel?order=${orderId}`,
    webhookUrl: `${APP_URL}/api/binance/webhook`,
    ...spec.body
  };
  const bodyText = JSON.stringify(body);
  const timestamp = String(Date.now());
  const nonce = crypto.randomBytes(16).toString('hex');
  const signature = createBinanceSignature(timestamp, nonce, bodyText, secretKey);
  const baseUrl = (process.env.BINANCE_PAY_BASE_URL || 'https://bpay.binanceapi.com').replace(/\/+$/, '');
  try {
    const response = await fetch(`${baseUrl}/binancepay/openapi/v3/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'BinancePay-Timestamp': timestamp,
        'BinancePay-Nonce': nonce,
        'BinancePay-Certificate-SN': apiKey,
        'BinancePay-Signature': signature
      },
      body: bodyText,
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== 'SUCCESS' || !result.data?.checkoutUrl) {
      console.error('[binance-create-order]', result.code || response.status, result.errorMessage || '');
      db.prepare("UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ?")
        .run(nowIso(), orderId);
      return res.status(502).json({
        error: 'Binance Pay অর্ডার তৈরি করতে পারেনি। Merchant settings, supported currency এবং API credentials যাচাই করুন।'
      });
    }
    db.prepare(`
      UPDATE orders
      SET binance_prepay_id = ?, checkout_url = ?, updated_at = ?
      WHERE id = ?
    `).run(result.data.prepayId || null, result.data.checkoutUrl, nowIso(), orderId);
    res.json({ orderId, checkoutUrl: result.data.checkoutUrl });
  } catch (error) {
    console.error('[binance-create-order]', error.message);
    db.prepare("UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ?")
      .run(nowIso(), orderId);
    res.status(502).json({ error: 'Binance Pay-এ সংযোগ করা যায়নি। পরে আবার চেষ্টা করুন।' });
  }
});
// Verify Binance's signed webhook before reading or updating any order.
app.post('/api/binance/webhook', express.raw({ type: 'application/json', limit: '100kb' }), (req, res) => {
  const timestamp = req.get('binancepay-timestamp') || '';
  const nonce = req.get('binancepay-nonce') || '';
  const signature = req.get('binancepay-signature') || '';
  const secret = process.env.BINANCE_PAY_SECRET_KEY || '';
  if (!secret || !Buffer.isBuffer(req.body) || !timestamp || !nonce || !signature) {
    return res.status(400).json({ returnCode: 'FAIL', returnMessage: 'Missing webhook signature data' });
  }

  const expected = createBinanceSignature(timestamp, nonce, req.body.toString('utf8'), secret);
  if (!safeEqual(signature.toUpperCase(), expected)) {
    return res.status(401).json({ returnCode: 'FAIL', returnMessage: 'Invalid signature' });
  }
  try {
    const event = JSON.parse(req.body.toString('utf8'));
    const data = typeof event.data === 'string'
      ? JSON.parse(event.data)
      : (event.data || event);

    const status = event.bizStatus || data.bizStatus || '';
    const merchantTradeNo = data.merchantTradeNo || event.merchantTradeNo || '';
    // Only the verified payment-success event may mark an order paid.
    if (status === 'PAY_SUCCESS' && merchantTradeNo) {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(merchantTradeNo);
      if (order) {
        const receivedCurrency = String(data.fiatCurrency || data.currency || '').toUpperCase();
        const receivedAmountRaw = data.fiatCurrency
          ? data.fiatAmount
          : (data.orderAmount ?? data.totalFee);
        if (receivedCurrency && receivedAmountRaw != null) {
          const currencyMatches = receivedCurrency === order.payment_currency.toUpperCase();
          const amountMatches = Math.abs(Number(receivedAmountRaw) - Number(order.payment_amount)) < 0.0000001;
          if (!currencyMatches || !amountMatches) {
            console.error('[binance-webhook] Amount/currency mismatch for order', merchantTradeNo);
            return res.status(400).json({ returnCode: 'FAIL', returnMessage: 'Order amount mismatch' });
          }
        }
        db.prepare(`
          UPDATE orders
          SET status = CASE WHEN status = 'fulfilled' THEN status ELSE 'paid' END,
              paid_at = COALESCE(paid_at, ?),
              updated_at = ?
          WHERE id = ?
        `).run(nowIso(), nowIso(), merchantTradeNo);
      }
    }
    return res.json({ returnCode: 'SUCCESS', returnMessage: null });
  } catch (error) {
    console.error('[binance-webhook]', error.message);
    return res.status(400).json({ returnCode: 'FAIL', returnMessage: 'Invalid payload' });
  }
});
app.get('/api/orders/:id', requireLogin, (req, res) => {
  const order = db.prepare(`
    SELECT id, product_id, price_bdt, payment_amount, payment_currency,
           status, created_at, paid_at, fulfilled_at
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
           payment_currency, status, note, created_at, paid_at, fulfilled_at
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
