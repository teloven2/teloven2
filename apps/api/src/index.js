import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import crypto from 'crypto';

// Mercado Pago SDK
import mercadopago from 'mercadopago';

const app = express();
const prisma = new PrismaClient();

const PORT = Number(process.env.PORT || 4000);
const NODE_ENV = process.env.NODE_ENV || 'development';
const WEB_BASE_URL = process.env.WEB_BASE_URL || 'http://localhost:3000';
const API_BASE_URL = process.env.API_BASE_URL || `http://localhost:${PORT}`;
const CORS_ORIGIN = process.env.CORS_ORIGIN || WEB_BASE_URL;

const JWT_SECRET = process.env.JWT_SECRET || '';
if (!JWT_SECRET) console.warn('⚠️ JWT_SECRET no configurado (apps/api/.env)');

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Teloven2 <no-reply@teloven2.local>';

if (!process.env.MP_ACCESS_TOKEN) {
  console.warn('⚠️ MP_ACCESS_TOKEN no está configurado. /checkout fallará hasta que lo pongas en apps/api/.env');
} else {
  mercadopago.configure({ access_token: process.env.MP_ACCESS_TOKEN });
}

app.use(helmet());
app.use(cors({ origin: CORS_ORIGIN, credentials: true }));
app.use(express.json({ limit: '2mb' }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: NODE_ENV === 'production' ? 30 : 200 });
const checkoutLimiter = rateLimit({ windowMs: 5 * 60 * 1000, max: NODE_ENV === 'production' ? 60 : 500 });

app.get('/v1/health', (_req, res) => res.json({ ok: true, service: 'teloven2-api', env: NODE_ENV }));

function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, isEmailVerified: user.isEmailVerified },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Falta token.' } });
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Token inválido.' } });
  }
}

function requireVerifiedEmail(req, res, next) {
  if (!req.user?.isEmailVerified) {
    return res.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Debes verificar tu email para continuar.' } });
  }
  next();
}

async function audit(action, { actorUserId = null, entityType = 'system', entityId = null, metadata = null } = {}) {
  try {
    await prisma.auditLog.create({ data: { action, actorUserId, entityType, entityId, metadata } });
  } catch {}
}


function buildVerifyEmailHtml({ name, verifyUrl }) {
  const safeName = (name || 'Hola').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `
  <div style="background:#f4f6f8;padding:24px">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:16px;padding:24px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;line-height:1.5;color:#111827">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <div style="width:40px;height:40px;border-radius:12px;background:#0A2540;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">T</div>
        <div>
          <div style="font-size:14px;color:#6B7280">Teloven2</div>
          <div style="font-size:18px;font-weight:800">Vende seguro. Cobra seguro. Compra tranquilo.</div>
        </div>
      </div>

      <h2 style="margin:16px 0 6px 0;font-size:22px">Verifica tu email</h2>
      <p style="margin:0 0 12px 0;color:#374151">Hola ${safeName} 👋</p>
      <p style="margin:0 0 18px 0;color:#374151">Confirma tu email para empezar a vender y comprar con seguridad en Teloven2.</p>

      <a href="${verifyUrl}" style="display:inline-block;background:#0A2540;color:#ffffff;text-decoration:none;padding:12px 16px;border-radius:12px;font-weight:700">
        Verificar mi cuenta
      </a>

      <p style="margin:18px 0 0 0;color:#6B7280;font-size:13px">
        Si no fuiste tú, ignora este mensaje. Este enlace expira en 24 horas.
      </p>

      <hr style="border:none;border-top:1px solid #e5e7eb;margin:18px 0" />
      <p style="margin:0;color:#6B7280;font-size:12px">
        Teloven2 · Pago protegido · Confirmación obligatoria
      </p>
    </div>
  </div>`;
}


/** AUTH (email-only) */
app.post('/v1/auth/register', authLimiter, async (req, res) => {
  const schema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(2),
  });
  const { email, password, name } = schema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return res.status(409).json({ error: { code: 'EMAIL_TAKEN', message: 'Este email ya está registrado.' } });

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await prisma.user.create({ data: { email, name, passwordHash } });

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.emailVerification.create({ data: { userId: user.id, token, expiresAt } });

  if (resend) {
    const verifyUrl = `${WEB_BASE_URL}/v1/auth/verify?token=${encodeURIComponent(token)}`; // typo-safe fallback
    const verifyUrlApi = `${API_BASE_URL}/v1/auth/verify?token=${encodeURIComponent(token)}`;
    const verifyUrlApi = `${API_BASE_URL}/v1/auth/verify?token=${encodeURIComponent(token)}`;
    await resend.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject: 'Verifica tu email en Teloven2',
      html: buildVerifyEmailHtml({ name, verifyUrl: verifyUrlApi }),
    });
    } else {
    console.warn('⚠️ RESEND_API_KEY no configurado: no se enviará email real.');
  }

  await audit('auth.register', { actorUserId: user.id, entityType: 'user', entityId: user.id });
  res.status(201).json({ ok: true, message: 'Revisa tu correo para verificar tu cuenta.' });
});

app.post('/v1/auth/resend-verification', authLimiter, async (req, res) => {
  const schema = z.object({ email: z.string().email() });
  const { email } = schema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });

  // Respondemos siempre OK para no filtrar si el email existe
  if (!user) return res.json({ ok: true, message: 'Si el correo existe, enviaremos un nuevo enlace.' });

  if (user.isEmailVerified) {
    return res.json({ ok: true, message: 'Tu email ya está verificado. Puedes iniciar sesión.' });
  }

  // Invalida tokens previos no usados
  await prisma.emailVerification.updateMany({
    where: { userId: user.id, used: false },
    data: { used: true },
  });

  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await prisma.emailVerification.create({ data: { userId: user.id, token, expiresAt } });

  if (resend) {
    const verifyUrlApi = `${API_BASE_URL}/v1/auth/verify?token=${encodeURIComponent(token)}`;
    await resend.emails.send({
      from: EMAIL_FROM,
      to: email,
      subject: 'Tu nuevo enlace de verificación — Teloven2',
      html: buildVerifyEmailHtml({ name: user.name, verifyUrl: verifyUrlApi }),
    });
  }

  await audit('auth.resend_verification', { actorUserId: user.id, entityType: 'user', entityId: user.id });
  return res.json({ ok: true, message: 'Si el correo existe, enviaremos un nuevo enlace.' });
});

app.get('/v1/auth/verify', async (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(400).send('Falta token');

  const ev = await prisma.emailVerification.findUnique({ where: { token } });
  if (!ev || ev.used) return res.status(400).send('Token inválido o ya usado');
  if (ev.expiresAt.getTime() < Date.now()) return res.status(400).send('Token expirado');

  const user = await prisma.user.update({ where: { id: ev.userId }, data: { isEmailVerified: true } });
  await prisma.emailVerification.update({ where: { token }, data: { used: true } });

  await audit('auth.verify_email', { actorUserId: user.id, entityType: 'user', entityId: user.id });
  res.redirect(`${WEB_BASE_URL}/auth/verified`);
});

app.post('/v1/auth/login', authLimiter, async (req, res) => {
  const schema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const { email, password } = schema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas.' } });

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Credenciales inválidas.' } });

  if (!user.isEmailVerified) {
    return res.status(403).json({ error: { code: 'EMAIL_NOT_VERIFIED', message: 'Debes verificar tu email.' } });
  }

  const token = signToken(user);
  await audit('auth.login', { actorUserId: user.id, entityType: 'user', entityId: user.id });
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, isEmailVerified: user.isEmailVerified } });
});

app.get('/v1/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.user.sub } });
  if (!user) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Usuario no existe' } });
  res.json({ id: user.id, email: user.email, name: user.name, isEmailVerified: user.isEmailVerified });
});

/** LISTINGS */
app.post('/v1/listings', requireAuth, requireVerifiedEmail, async (req, res) => {
  const schema = z.object({
    type: z.enum(['product', 'service']),
    title: z.string().min(2),
    description: z.string().min(1),
    price: z.number().int().positive(),
    currency: z.string().default('CLP'),
  });
  const body = schema.parse(req.body);
  const listing = await prisma.listing.create({ data: { ...body, sellerId: req.user.sub } });
  await audit('listing.create', { actorUserId: req.user.sub, entityType: 'listing', entityId: listing.id });
  res.status(201).json({ listing });
});

app.get('/v1/listings', async (_req, res) => {
  const items = await prisma.listing.findMany({ where: { status: 'active' }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ items });
});

/** ORDERS */
app.post('/v1/orders', requireAuth, requireVerifiedEmail, async (req, res) => {
  const schema = z.object({ listingId: z.string().uuid() });
  const { listingId } = schema.parse(req.body);

  const listing = await prisma.listing.findUnique({ where: { id: listingId } });
  if (!listing) return res.status(404).json({ error: { code: 'LISTING_NOT_FOUND', message: 'Listing no existe.' } });

  const platformFee = Math.round(listing.price * 0.06);
  const total = listing.price + platformFee;

  const order = await prisma.order.create({
    data: { listingId, buyerId: req.user.sub, sellerId: listing.sellerId, price: listing.price, platformFee, total },
  });

  await audit('order.create', { actorUserId: req.user.sub, entityType: 'order', entityId: order.id });
  res.status(201).json({ order });
});

app.post('/v1/orders/:id/checkout', requireAuth, requireVerifiedEmail, checkoutLimiter, async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, include: { listing: true } });
  if (!order) return res.status(404).json({ error: { code: 'ORDER_NOT_FOUND', message: 'Orden no existe.' } });

  if (order.buyerId !== req.user.sub) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Solo el comprador puede pagar.' } });
  if (order.status !== 'CREATED') return res.status(409).json({ error: { code: 'ORDER_STATE_INVALID', message: `Estado inválido: ${order.status}` } });
  if (!process.env.MP_ACCESS_TOKEN) return res.status(500).json({ error: { code: 'MP_NOT_CONFIGURED', message: 'MP_ACCESS_TOKEN no configurado.' } });

  const preferenceBody = {
    items: [{ title: order.listing.title, quantity: 1, currency_id: order.listing.currency ?? 'CLP', unit_price: Number(order.total) }],
    external_reference: order.id,
    back_urls: {
      success: `${WEB_BASE_URL}/pay/success?orderId=${order.id}`,
      failure: `${WEB_BASE_URL}/pay/failure?orderId=${order.id}`,
      pending: `${WEB_BASE_URL}/pay/pending?orderId=${order.id}`,
    },
    auto_return: 'approved',
    notification_url: `${API_BASE_URL}/v1/webhooks/mercadopago`,
  };

  const result = await mercadopago.preferences.create(preferenceBody);
  const preferenceId = result?.body?.id;
  const initPoint = result?.body?.init_point;

  await prisma.order.update({ where: { id: order.id }, data: { mpPreferenceId: preferenceId ?? null } });
  await audit('order.checkout_created', { actorUserId: req.user.sub, entityType: 'order', entityId: order.id, metadata: { preferenceId } });

  res.json({ provider: 'mercadopago', preferenceId, initPoint });
});

/** Webhook Mercado Pago */
app.post('/v1/webhooks/mercadopago', async (req, res) => {
  try {
    const event = req.body;
    const eventId = (event?.id ?? event?.data?.id ?? '').toString();
    if (!eventId) return res.status(200).json({ ok: true });

    const exists = await prisma.webhookEvent.findFirst({ where: { provider: 'mercadopago', eventId } });
    if (exists) return res.status(200).json({ ok: true, deduped: true });

    await prisma.webhookEvent.create({ data: { provider: 'mercadopago', eventId, payload: event } });

    const paymentId = (event?.data?.id ?? event?.data?.payment_id ?? event?.resource ?? '').toString();
    if (!paymentId || !process.env.MP_ACCESS_TOKEN) return res.status(200).json({ ok: true });

    const payment = await mercadopago.payment.findById(paymentId);
    const status = payment?.body?.status;
    const externalRef = payment?.body?.external_reference;
    const amount = Number(payment?.body?.transaction_amount || 0);
    const currency = String(payment?.body?.currency_id || 'CLP');

    if (!externalRef) return res.status(200).json({ ok: true });
    const order = await prisma.order.findUnique({ where: { id: String(externalRef) } });
    if (!order) return res.status(200).json({ ok: true });

    if (amount !== order.total) {
      await audit('payment.amount_mismatch', { entityType: 'order', entityId: order.id, metadata: { amount, expected: order.total, paymentId } });
      return res.status(200).json({ ok: true });
    }

    await prisma.payment.create({
      data: { orderId: order.id, provider: 'mercadopago', providerPaymentId: paymentId, providerEventId: eventId, status: status || 'unknown', amount, currency, rawEvent: event },
    }).catch(() => {});

    if (status === 'approved' && order.status === 'CREATED') {
      await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID_IN_CUSTODY', paidAt: new Date(), mpPaymentId: paymentId } });
      await audit('payment.approved', { entityType: 'order', entityId: order.id, metadata: { paymentId } });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Webhook error', err);
    res.status(200).json({ ok: true });
  }
});

app.listen(PORT, () => {
  console.log(`✅ teloven2-api en ${API_BASE_URL}`);
  console.log(`   CORS_ORIGIN=${CORS_ORIGIN}`);
});
