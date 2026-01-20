import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { PrismaClient } from "@prisma/client";
import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { Resend } from "resend";
import crypto from "crypto";

/* =========================
   App & DB
========================= */
const app = express();
app.set("trust proxy", 1);
const prisma = new PrismaClient();

/* =========================
   ENV
========================= */
const PORT = Number(process.env.PORT || 4000);
const NODE_ENV = process.env.NODE_ENV || "development";
const WEB_BASE_URL = process.env.WEB_BASE_URL || "http://localhost:3000";
const API_BASE_URL =
  process.env.API_BASE_URL || `http://localhost:${PORT}`;

const JWT_SECRET = process.env.JWT_SECRET || "";
if (!JWT_SECRET) {
  console.warn("⚠️ JWT_SECRET no configurado");
}

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

const EMAIL_FROM =
  process.env.EMAIL_FROM || "Teloven2 <no-reply@teloven2.local>";

/* =========================
   Security & CORS
========================= */
app.use(helmet());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const isLocal =
        /^http:\/\/localhost(:\d+)?$/.test(origin) ||
        /^http:\/\/127\.0\.0\.1(:\d+)?$/.test(origin);

      const isVercel = /^https:\/\/.*\.vercel\.app$/.test(origin);

      const isProd =
        origin === "https://teloven2.cl" ||
        origin === "https://www.teloven2.cl";

      if (isLocal || isVercel || isProd) {
        return callback(null, true);
      }

      return callback(new Error(`CORS bloqueado para ${origin}`));
    },
    credentials: true,
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =========================
   Rate limits
========================= */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: NODE_ENV === "production" ? 30 : 200,
});

/* =========================
   Helpers
========================= */
function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      isEmailVerified: user.isEmailVerified,
    },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ")
      ? header.slice(7)
      : null;

    if (!token) {
      return res
        .status(401)
        .json({ error: "Falta token" });
    }

    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res
      .status(401)
      .json({ error: "Token inválido" });
  }
}

/* =========================
   Health
========================= */
app.get("/v1/health", (_req, res) => {
  res.json({
    ok: true,
    service: "teloven2-api",
    env: NODE_ENV,
  });
});

/* =========================
   Email template
========================= */
function buildVerifyEmailHtml({ name, verifyUrl }) {
  const safeName = (name || "Hola")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `
  <div style="font-family:system-ui;background:#f4f6f8;padding:24px">
    <div style="max-width:560px;margin:auto;background:#fff;border-radius:16px;padding:24px">
      <h2>Verifica tu email</h2>
      <p>Hola ${safeName} 👋</p>
      <p>Confirma tu correo para empezar a usar Teloven2.</p>
      <a href="${verifyUrl}" style="display:inline-block;padding:12px 16px;background:#0A2540;color:#fff;border-radius:10px;text-decoration:none">
        Verificar cuenta
      </a>
      <p style="margin-top:16px;font-size:13px;color:#6b7280">
        Este enlace expira en 24 horas.
      </p>
    </div>
  </div>`;
}

/* =========================
   AUTH
========================= */
app.post(
  "/v1/auth/register",
  authLimiter,
  async (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string().min(8),
      name: z.string().min(2),
    });

    const { email, password, name } = schema.parse(req.body);

    const exists = await prisma.user.findUnique({
      where: { email },
    });

    if (exists) {
      return res
        .status(409)
        .json({ error: "Email ya registrado" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const user = await prisma.user.create({
      data: { email, name, passwordHash },
    });

    const token = crypto.randomUUID();
    const expiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000
    );

    await prisma.emailVerification.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    if (resend) {
      const verifyUrl = `${API_BASE_URL}/v1/auth/verify?token=${token}`;

      await resend.emails.send({
        from: EMAIL_FROM,
        to: email,
        subject: "Verifica tu cuenta en Teloven2",
        html: buildVerifyEmailHtml({
          name,
          verifyUrl,
        }),
      });
    }

    res.status(201).json({
      ok: true,
      message: "Revisa tu correo para verificar tu cuenta",
    });
  }
);

app.get("/v1/auth/verify", async (req, res) => {
  const token = String(req.query.token || "");

  const record = await prisma.emailVerification.findUnique({
    where: { token },
  });

  if (
    !record ||
    record.used ||
    record.expiresAt < new Date()
  ) {
    return res.redirect(
      `${WEB_BASE_URL}/auth/verified?status=error`
    );
  }

  await prisma.user.update({
    where: { id: record.userId },
    data: { isEmailVerified: true },
  });

  await prisma.emailVerification.update({
    where: { token },
    data: { used: true },
  });

  res.redirect(
    `${WEB_BASE_URL}/auth/verified?status=success`
  );
});

app.post(
  "/v1/auth/login",
  authLimiter,
  async (req, res) => {
    const schema = z.object({
      email: z.string().email(),
      password: z.string(),
    });

    const { email, password } = schema.parse(req.body);

    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return res
        .status(401)
        .json({ error: "Credenciales inválidas" });
    }

    const ok = await bcrypt.compare(
      password,
      user.passwordHash
    );

    if (!ok) {
      return res
        .status(401)
        .json({ error: "Credenciales inválidas" });
    }

    if (!user.isEmailVerified) {
      return res
        .status(403)
        .json({ error: "Email no verificado" });
    }

    const token = signToken(user);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    });
  }
);

/* =========================
   ME
========================= */
app.get("/v1/me", requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.user.sub },
  });

  if (!user) {
    return res.status(404).json({ error: "No existe" });
  }

  res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    isEmailVerified: user.isEmailVerified,
  });
});

/* =========================
   Errors
========================= */
app.use((err, _req, res, _next) => {
  console.error("❌ Error:", err);
  res.status(500).json({ error: "INTERNAL_ERROR" });
});

/* =========================
   Start
========================= */
app.listen(PORT, () => {
  console.log(`✅ teloven2-api en ${API_BASE_URL}`);
});