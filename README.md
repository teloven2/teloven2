# Teloven2 MVP (email-only) — Web + App + API
Incluye:
- **apps/web**: Next.js (Web)
- **apps/mobile**: Expo (React Native)
- **apps/api**: Node.js (Express) + Prisma + PostgreSQL + Mercado Pago + **Auth email-only (Resend)**

## 1) Variables de entorno
Copia:
- `apps/api/.env.example` → `apps/api/.env`
- `apps/web/.env.example` → `apps/web/.env`

Completa:
- `DATABASE_URL`
- `JWT_SECRET`
- `RESEND_API_KEY` + `EMAIL_FROM`
- `MP_ACCESS_TOKEN`

## 2) Instalar
```bash
pnpm install
```

## 3) BD
```bash
pnpm db:generate
pnpm db:migrate
```

## 4) Correr
```bash
pnpm dev
```

## Auth (email-only)
1) `POST /v1/auth/register` → envía email con link a `GET /v1/auth/verify?token=...`  
2) Login: `POST /v1/auth/login` (requiere email verificado)


### Reenviar verificación
`POST /v1/auth/resend-verification` con `{ "email": "..." }`.
