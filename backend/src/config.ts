import dotenv from 'dotenv';
dotenv.config();

const required = ['DATABASE_URL', 'JWT_SECRET', 'FRONTEND_URL'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length) {
  console.error('❌  Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

export const config = {
  port: parseInt(process.env.PORT ?? '4000'),
  databaseUrl: process.env.DATABASE_URL!,
  jwtSecret: process.env.JWT_SECRET!,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '15m',
  refreshTokenExpiresInMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  frontendUrl: process.env.FRONTEND_URL!,
  encryptionKey: process.env.ENCRYPTION_KEY ?? '',
  metaAppSecret: process.env.META_APP_SECRET ?? '',
  metaAppId: process.env.META_APP_ID ?? '',
  metaWebhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN ?? 'digygo_webhook_verify',
  webhookBaseUrl: process.env.WEBHOOK_BASE_URL ?? process.env.FRONTEND_URL!,
  nodeEnv: process.env.NODE_ENV ?? 'development',
  redisUrl: process.env.REDIS_URL ?? '',   // empty = Redis disabled, caches fall back to in-memory
  smtp: {
    host:     process.env.SMTP_HOST     ?? '',
    port:     parseInt(process.env.SMTP_PORT ?? '587'),
    secure:   process.env.SMTP_SECURE   === 'true',
    user:     process.env.SMTP_USER     ?? '',
    pass:     process.env.SMTP_PASS     ?? '',
    fromName: process.env.SMTP_FROM_NAME ?? 'Hawcus CRM',
    fromEmail:process.env.SMTP_FROM_EMAIL ?? '',
  },
  resend: {
    apiKey:   process.env.RESEND_API_KEY ?? '',
    from:     process.env.RESEND_FROM ?? '',   // e.g. "DigyGo CRM <noreply@digygo.in>"
  },
};
