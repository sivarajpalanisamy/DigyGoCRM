import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pool } from './db';
import { runMigrations } from './db/migrate';
import { validateSchema } from './db/schema-validator';
import { config } from './config';
import { initSocket } from './socket';

import authRoutes         from './routes/auth';
import leadsRoutes        from './routes/leads';
import contactsRoutes     from './routes/contacts';
import calendarRoutes     from './routes/calendar';
import formsRoutes        from './routes/forms';
import settingsRoutes     from './routes/settings';
import pipelinesRoutes    from './routes/pipelines';
import workflowsRoutes, { processDelayedSteps, processScheduledTriggers, processBroadcastQueue, publicWorkflowRouter } from './routes/workflows';
import tagsRoutes         from './routes/tags';
import opportunitiesRoutes from './routes/opportunities';
import templatesRoutes    from './routes/templates';
import publicRoutes       from './routes/public';
import integrationsRoutes, { pollMetaLeads } from './routes/integrations';
import webhooksRoutes         from './routes/webhooks';
import conversationsRoutes    from './routes/conversations';
import fieldsRoutes           from './routes/fields';
import assignmentRulesRoutes  from './routes/assignment_rules';
import landingPagesRoutes     from './routes/landing_pages';
import notificationsRoutes    from './routes/notifications';
import { processFollowUpReminders } from './utils/notifications';
import waPersonalRoutes from './routes/whatsapp_personal';
import { restoreAllSessions } from './services/whatsapp/sessionManager';
import whatsappFlowsRoutes    from './routes/whatsapp_flows';
import dashboardRoutes        from './routes/dashboard';
import pincodeRoutingRoutes   from './routes/pincode_routing';
import fieldRoutingRoutes     from './routes/field_routing';
import leadGenerationRoutes   from './routes/leadGeneration';
import reportsRoutes          from './routes/reports';
import contactGroupsRoutes    from './routes/contact_groups';
import waPersonalTemplatesRoutes from './routes/wa_personal_templates';
import callsRoutes from './routes/calls';
import googleSheetsRoutes from './routes/google_sheets';
import { processRecordingDownloads } from './utils/recordingDownloader';
import { pollGoogleSheets } from './utils/googleSheetsPoller';
import { resolveDomain } from './middleware/domainResolver';
import { query as dbQuery } from './db';
import { sendEmail } from './services/email';
import { initCorsOrigins, isAllowedOrigin, addAllowedOrigin } from './utils/corsOrigins';

const app        = express();
const httpServer = createServer(app);
const PORT       = config.port;

app.set('trust proxy', 1);

initSocket(httpServer, config.frontendUrl);

// ── Security headers ──────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", config.frontendUrl, 'https://graph.facebook.com'],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// ── CORS ──────────────────────────────────────────────────────────────────────
// Seed base origins into shared corsOrigins store
initCorsOrigins(
  [config.frontendUrl, process.env.WEBHOOK_BASE_URL, process.env.EXTRA_ORIGIN].filter(Boolean) as string[]
);

// Load active custom domains into CORS allowlist on startup
(async () => {
  try {
    const r = await dbQuery(
      "SELECT custom_domain FROM tenants WHERE domain_status='ssl_active' AND custom_domain IS NOT NULL"
    );
    r.rows.forEach((row: any) => addAllowedOrigin(row.custom_domain));
    if (r.rows.length > 0) console.log(`🌐  Loaded ${r.rows.length} custom domain(s) into CORS allowlist`);
  } catch { /* DB may not be ready yet */ }
})();

// Public form submit + public booking endpoints need cross-origin access
// so they work when the HTML snippet is embedded on any external website.
// These routes carry no auth — open CORS is safe here.
const isPublicCrossOriginPath = (path: string) =>
  path.endsWith('/submit') || path.startsWith('/api/public');

app.use((req, res, next) => {
  if (isPublicCrossOriginPath(req.path)) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
    return next();
  }
  // Strict CORS for all other routes (authenticated CRM APIs)
  return cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (mobile apps, curl, server-to-server)
      if (!origin || isAllowedOrigin(origin)) { cb(null, true); return; }
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  })(req, res, next);
});

// ── Rate limiting ─────────────────────────────────────────────────────────────
// Global limiter: 1000 req / 60 s per IP (allows normal CRM usage with polling)
app.use(rateLimit({
  windowMs: 60_000,
  max: process.env.NODE_ENV === 'production' ? 1000 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
  skip: (req) => req.path === '/health',
}));

// Strict limiter for login and password setup — brute-force protection
const authLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: process.env.NODE_ENV === 'production' ? 30 : 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in 15 minutes.' },
});

// Relaxed limiter for token refresh — not a brute-force vector (token itself is the secret)
// Must handle: multiple tabs, 30s polling, multiple users behind same NAT IP
const refreshLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max: process.env.NODE_ENV === 'production' ? 300 : 5000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' },
});

// ── Custom domain resolver — runs before all routes ───────────────────────────
app.use(resolveDomain);

// ── Body parsing & cookies ────────────────────────────────────────────────────
// Raw body must be captured BEFORE express.json() for HMAC-SHA256 signature verification.
// Both Meta webhook endpoints need it — Meta signs with app secret over raw bytes.
app.use('/api/integrations/meta/webhook', express.raw({ type: '*/*' }));
app.use('/api/webhooks/meta',             express.raw({ type: '*/*' }));
app.use('/api/webhooks/whatsapp',         express.raw({ type: '*/*' }));
app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── Webhook echo (used by workflow test runner to verify webhook_call action) ─
app.post('/webhook-echo', (_req, res) => {
  res.json({ received: true, ts: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth/login',          authLimiter);    // brute-force protection on login
app.use('/api/auth/refresh',        refreshLimiter); // higher limit — token itself is the secret
app.use('/api/auth/setup-password', authLimiter);    // password setup rate limit
app.use('/api/auth',          authRoutes);
app.use('/api/dashboard',     dashboardRoutes);
app.use('/api/leads',         leadsRoutes);
app.use('/api/contacts',      contactsRoutes);
app.use('/api/calendar',      calendarRoutes);
app.use('/api/forms',         formsRoutes);
app.use('/api/settings',      settingsRoutes);
app.use('/api/pipelines',     pipelinesRoutes);
app.use('/api/workflows',     workflowsRoutes);
app.use('/api/wf',            publicWorkflowRouter);
app.use('/api/tags',          tagsRoutes);
app.use('/api/opportunities', opportunitiesRoutes);
app.use('/api/templates',     templatesRoutes);
app.use('/api/public',        publicRoutes);
app.use('/api/integrations',  integrationsRoutes);
app.use('/api/webhooks',      webhooksRoutes);
app.use('/api/conversations', conversationsRoutes);
app.use('/api/fields',            fieldsRoutes);
app.use('/api/assignment-rules',  assignmentRulesRoutes);
app.use('/api/landing-pages',     landingPagesRoutes);
app.use('/api/notifications',     notificationsRoutes);
app.use('/api/whatsapp-flows',    whatsappFlowsRoutes);
app.use('/api/pincode-routing',   pincodeRoutingRoutes);
app.use('/api/field-routing',     fieldRoutingRoutes);
app.use('/api/lead-generation',   leadGenerationRoutes);
app.use('/api/reports',           reportsRoutes);
app.use('/api/contact-groups',    contactGroupsRoutes);
app.use('/api/whatsapp-personal', waPersonalRoutes);
app.use('/api/wa-personal-templates', waPersonalTemplatesRoutes);
app.use('/api/calls',             callsRoutes);
app.use('/api/integrations/sheets', googleSheetsRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ─────────────────────────────────────────────────────────────────────
runMigrations()
  .catch((err) => {
    console.error('Startup migration failed — continuing anyway:', err.message);
  })
  .then(() => validateSchema())
  .finally(() => {
    // ── Delay queue worker: runs every 30 seconds ─────────────────────────────
    setInterval(() => processDelayedSteps().catch(() => null), 30_000);
    console.log('⏱️   Delay queue worker started (30s interval)');

    setInterval(() => processBroadcastQueue().catch(() => null), 30_000);
    console.log('📡  Broadcast queue worker started (30s interval)');

    setInterval(() => pollMetaLeads().catch(() => null), 5 * 60_000);
    console.log('📘  Meta leads poll worker started (5min interval)');

    setInterval(() => processScheduledTriggers().catch(() => null), 60_000);
    console.log('📅  Schedule trigger worker started (60s interval)');

    setInterval(() => processFollowUpReminders().catch(() => null), 5 * 60_000);
    console.log('🔔  Follow-up reminder worker started (5min interval)');

    setInterval(() => processRecordingDownloads().catch(() => null), 10 * 60_000);
    console.log('🎙️   Recording download worker started (10min interval)');

    setInterval(() => pollGoogleSheets().catch(() => null), 5 * 60_000);
    console.log('📊  Google Sheets poll worker started (5min interval)');

    restoreAllSessions().catch(() => null);
    console.log('📱  WhatsApp Personal session restore initiated');

    // SSL expiry monitoring — runs nightly (every 24 hours)
    // Traefik auto-renews certs, but alert if any domain has been active > 75 days
    // (LE certs expire at 90 days; Traefik renews at ~60 days)
    const checkDomainExpiry = async () => {
      try {
        const r = await dbQuery(`
          SELECT custom_domain, name, domain_verified_at
          FROM tenants
          WHERE domain_status = 'ssl_active'
            AND domain_verified_at < NOW() - INTERVAL '75 days'
        `);
        for (const tenant of r.rows) {
          const expiryDate = new Date(new Date(tenant.domain_verified_at).getTime() + 90 * 24 * 60 * 60 * 1000).toDateString();
          await sendEmail({
            to: process.env.ADMIN_ALERT_EMAIL ?? 'admin@digygo.in',
            subject: `⚠️ SSL Expiring Soon: ${tenant.custom_domain}`,
            html: `<p>SSL certificate for <strong>${tenant.name}</strong> (<code>${tenant.custom_domain}</code>) expires on <strong>${expiryDate}</strong>.</p>
                   <p>Please re-verify from the super admin panel or run <code>certbot renew</code> on the server.</p>`,
          }).catch(() => null);
          console.log(`[domain-expiry] Alert sent for ${tenant.custom_domain} (expires ${expiryDate})`);
        }
      } catch (err) {
        console.error('[domain-expiry] check failed:', err);
      }
    };
    setInterval(() => checkDomainExpiry(), 24 * 60 * 60_000);
    // Run once at startup after a short delay (DB must be ready)
    setTimeout(() => checkDomainExpiry().catch(() => null), 60_000);
    console.log('🔐  Domain SSL expiry monitor started (24h interval)');

    httpServer.listen(PORT, () => {
      console.log(`\n🚀  DigyGo CRM Backend running on http://localhost:${PORT}`);
      console.log(`📊  Health: http://localhost:${PORT}/health`);
      console.log(`🌍  Env: ${config.nodeEnv}\n`);
    });

    httpServer.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        console.error(`\n❌  Port ${PORT} is already in use.`);
        console.error(`   Run: taskkill /F /IM node.exe  (kills all node processes)`);
        console.error(`   Or:  netstat -ano | findstr :${PORT}  then taskkill /PID <pid> /F\n`);
        process.exit(1);
      } else {
        throw err;
      }
    });
  });
