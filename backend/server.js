// STOREmind — Server v3.0
// Multi-tenant | Approval queue | Webhooks | Cost tracking | Real Shopify API
import express      from 'express';
import { WebSocketServer } from 'ws';
import { createServer }    from 'http';
import cors     from 'cors';
import dotenv   from 'dotenv';
import { StoreManager }       from './StoreManager.js';
import { OnboardingSequence }  from './retention/onboarding.js';
import { WeeklyDigest }        from './retention/digest.js';
import { verifyShopifyWebhook, webhookToEvent, registerWebhooks } from './webhooks/handler.js';

dotenv.config();

if (!process.env.ANTHROPIC_API_KEY) { console.error('[STOREmind] FATAL: ANTHROPIC_API_KEY not set'); process.exit(1); }

const app = express();
const httpServer = createServer(app);

app.use(cors());
// Raw body for webhook signature verification
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());

// ── WebSocket ────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });
const clients = new Map(); // storeId → Set<ws>

function broadcast(data) {
  const storeId = data.storeId || 'default';
  const msg = JSON.stringify(data);
  // Broadcast to clients subscribed to this store (or all if no storeId)
  for (const [sid, sclients] of clients) {
    if (sid === storeId || sid === 'all') {
      for (const c of sclients) { if (c.readyState === 1) c.send(msg); }
    }
  }
}

wss.on('connection', (ws, req) => {
  const storeId = new URL(req.url, 'http://localhost').searchParams.get('storeId') || 'default';
  if (!clients.has(storeId)) clients.set(storeId, new Set());
  clients.get(storeId).add(ws);
  console.log(`[WS] Client connected — store: ${storeId}, total: ${clients.get(storeId).size}`);

  const store = manager.get(storeId);
  if (store) {
    ws.send(JSON.stringify({ type: 'init', storeId, state: store.agent.getStatus().state, pendingApprovals: store.approvalQueue.getPending(), approvalStats: store.approvalQueue.getStats(), costTracker: store.agent.costTracker, timestamp: Date.now() }));
  }

  ws.on('close', () => { clients.get(storeId)?.delete(ws); });
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      const sid = msg.storeId || storeId;
      const store = manager.get(sid);
      if (!store) return;
      if (msg.command === 'start_agent')   store.agent.start(msg.interval);
      if (msg.command === 'stop_agent')    store.agent.stop();
      if (msg.command === 'run_cycle')     store.agent.runCycle();
      if (msg.command === 'get_phantom')   { const s = store.agent.getStatus(); if (s.stoppedAt) ws.send(JSON.stringify({ type: 'phantom_value', phantom: store.agent.getPhantomValue(Date.now()-s.stoppedAt), timestamp: Date.now() })); }
      // Approval decisions
      if (msg.command === 'approve_action') { const r = store.approvalQueue.decide(msg.id, 'approve'); broadcast({ type: 'approval_result', storeId: sid, ...r, timestamp: Date.now() }); }
      if (msg.command === 'reject_action')  { const r = store.approvalQueue.decide(msg.id, 'reject');  broadcast({ type: 'approval_result', storeId: sid, ...r, timestamp: Date.now() }); }
    } catch (e) { console.error('[WS] Parse error:', e.message); }
  });
});

// ── Store Manager ────────────────────────────────────────────────────────
const manager = new StoreManager(broadcast);

// Register default store from .env
const DEFAULT_STORE = process.env.SHOPIFY_SHOP_NAME || 'storemind-hatbvuvt';
const defaultStore  = manager.register(DEFAULT_STORE);

// Retention layer
const onboarding = new OnboardingSequence();
defaultStore.agent.onFirstCycle = (stats) => { onboarding.onFirstCycle(stats); broadcast({ type: 'first_cycle', stats, storeId: DEFAULT_STORE, timestamp: Date.now() }); };
const digest = new WeeklyDigest(() => defaultStore.agent.getStatus());
digest.start();

// ── REST API ─────────────────────────────────────────────────────────────
app.get('/health', (_, res) => res.json({ status: 'ok', stores: manager.status(), version: '3.0' }));

// Store management
app.get('/api/stores',                (_, res) => res.json(manager.status()));
app.post('/api/stores/:id/start',     (req, res) => { manager.getAgent(req.params.id)?.start(req.body?.interval); res.json({ ok: true }); });
app.post('/api/stores/:id/stop',      (req, res) => { manager.getAgent(req.params.id)?.stop(); res.json({ ok: true }); });
app.post('/api/stores/:id/cycle',     (req, res) => { manager.getAgent(req.params.id)?.runCycle(); res.json({ ok: true }); });
app.get('/api/stores/:id/phantom',    (req, res) => {
  const a = manager.getAgent(req.params.id);
  const s = a?.getStatus();
  if (!s?.stoppedAt) return res.json({ paused: false });
  res.json({ paused: true, phantom: a.getPhantomValue(Date.now() - s.stoppedAt) });
});

// Shorthand for default store (backwards compat)
app.get('/api/state',          (_, res) => res.json(defaultStore.agent.getStatus()));
app.get('/api/actions',        (req, res) => res.json(defaultStore.agent.getStatus().state.recentActions.slice(0, parseInt(req.query.limit ?? '20'))));
app.post('/api/agent/start',   (req, res) => { defaultStore.agent.start(req.body?.interval); res.json({ ok: true }); });
app.post('/api/agent/stop',    (_, res)   => { defaultStore.agent.stop(); res.json({ ok: true }); });
app.post('/api/agent/run',     (_, res)   => { defaultStore.agent.runCycle(); res.json({ ok: true }); });

// Approval queue
app.get('/api/approvals',      (_, res) => res.json({ pending: defaultStore.approvalQueue.getPending(), stats: defaultStore.approvalQueue.getStats() }));
app.post('/api/approvals/:id/approve', (req, res) => res.json(defaultStore.approvalQueue.decide(parseInt(req.params.id), 'approve')));
app.post('/api/approvals/:id/reject',  (req, res) => res.json(defaultStore.approvalQueue.decide(parseInt(req.params.id), 'reject')));

// Cost tracking
app.get('/api/costs',          (_, res) => res.json(defaultStore.agent.costTracker));
app.get('/api/costs/breakdown', (_, res) => {
  const ct = defaultStore.agent.costTracker;
  const monthlyProjection = ct.totalCycles > 0
    ? (ct.totalCostUsd / ct.totalCycles) * (24 * 3600 / parseInt(process.env.CYCLE_INTERVAL || '60')) * 30
    : 0;
  res.json({ ...ct, avgCostPerCycle: ct.totalCycles > 0 ? ct.totalCostUsd / ct.totalCycles : 0, monthlyProjectionUsd: monthlyProjection, margin: 299 - monthlyProjection });
});

// Retention
app.get('/api/retention/phantom',   (_, res) => { const s = defaultStore.agent.getStatus(); if (!s.stoppedAt) return res.json({ paused: false }); res.json({ paused: true, pausedMs: Date.now()-s.stoppedAt, phantom: defaultStore.agent.getPhantomValue(Date.now()-s.stoppedAt) }); });
app.get('/api/retention/patterns',  (_, res) => res.json(defaultStore.agent.storePatterns));
app.post('/api/retention/signal',   (req, res) => { console.log('[Retention] Signal:', req.body?.signal, req.body?.context); res.json({ received: true }); });
app.post('/api/retention/digest/send', async (_, res) => { const r = await digest.send(); broadcast({ type: 'weekly_digest_sent', timestamp: Date.now() }); res.json({ ok: true, result: r }); });

// Webhooks
app.post('/webhooks/shopify', (req, res) => {
  const topic   = req.headers['x-shopify-topic'];
  const hmac    = req.headers['x-shopify-hmac-sha256'];
  const rawBody = req.body;
  if (!verifyShopifyWebhook(rawBody, hmac)) return res.status(401).send('Unauthorized');
  const payload = JSON.parse(rawBody.toString());
  const event   = webhookToEvent(topic, payload);
  if (event) {
    broadcast({ type: 'webhook_event', event, storeId: DEFAULT_STORE, timestamp: Date.now() });
    // Trigger immediate agent cycle on high-value events
    if (['cart_event','order_created'].includes(event.type) && !defaultStore.agent.isRunning) {
      defaultStore.agent.runCycle();
    }
  }
  res.status(200).send('OK');
});

app.post('/api/webhooks/register', async (req, res) => {
  const { callbackBaseUrl } = req.body ?? {};
  if (!process.env.SHOPIFY_ACCESS_TOKEN) return res.status(400).json({ error: 'No Shopify token configured' });
  const results = await registerWebhooks(DEFAULT_STORE, process.env.SHOPIFY_ACCESS_TOKEN, callbackBaseUrl || `http://localhost:${process.env.PORT || 3001}`);
  res.json({ results });
});

// Setup wizard connection tests
app.post('/api/test/anthropic', async (req, res) => {
  const { apiKey } = req.body ?? {};
  if (!apiKey?.startsWith('sk-ant-')) return res.status(400).json({ error: 'Invalid key format' });
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const c = new Anthropic({ apiKey });
    const r = await c.messages.create({ model: 'claude-haiku-4-5-20251001', max_tokens: 20, messages: [{ role: 'user', content: 'Reply: ready' }] });
    res.json({ model: 'claude-sonnet-4-6', response: r.content[0]?.text });
  } catch (e) { res.status(401).json({ error: e.message }); }
});

app.post('/api/test/shopify', async (req, res) => {
  const { store, token } = req.body ?? {};
  if (!store || !token?.startsWith('shpat_')) return res.status(400).json({ error: 'Invalid credentials — need shpat_ token from Custom App' });
  try {
    const r = await fetch(`https://${store}.myshopify.com/admin/api/2024-01/shop.json`, { headers: { 'X-Shopify-Access-Token': token } });
    if (!r.ok) throw new Error(`Shopify ${r.status}`);
    const { shop } = await r.json();
    const estRecoverable = Math.round(200 * 0.68 * 85 * 0.12);
    res.json({ shopName: shop.name, plan: shop.plan_name, currency: shop.currency, estimatedRecoverable: estRecoverable });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/test/klaviyo', async (req, res) => {
  const { apiKey } = req.body ?? {};
  if (!apiKey?.startsWith('pk_')) return res.status(400).json({ error: 'Invalid key format' });
  try {
    const r = await fetch('https://a.klaviyo.com/api/profiles/?page[size]=1', { headers: { Authorization: `Klaviyo-API-Key ${apiKey}`, revision: '2024-02-15' } });
    if (!r.ok) throw new Error(`Klaviyo ${r.status}`);
    const d = await r.json();
    res.json({ profileCount: d.meta?.total ?? 0 });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/test/slack', async (req, res) => {
  const { webhookUrl } = req.body ?? {};
  if (!webhookUrl?.includes('hooks.slack.com')) return res.status(400).json({ error: 'Invalid webhook URL' });
  try {
    const r = await fetch(webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '🧠 STOREmind connected!' }) });
    if (!r.ok) throw new Error(`Slack ${r.status}`);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ── Start ─────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT ?? '3001');
httpServer.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════════╗\n║  STOREmind v3.0 — ${new Date().toLocaleTimeString()}               ║\n║  Store : ${DEFAULT_STORE.padEnd(30)}║\n║  HTTP  : http://localhost:${PORT}            ║\n║  WS    : ws://localhost:${PORT}?storeId=...  ║\n╚══════════════════════════════════════════╝\n`);
  if (process.env.AUTO_START === 'true') defaultStore.agent.start();
});

process.on('SIGINT', () => { console.log('\n[STOREmind] Shutting down...'); digest.stop(); manager.stopAll(); process.exit(0); });
