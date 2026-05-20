// STOREmind — Express + WebSocket Server v2.0 (with retention layer)
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { STOREmindAgent } from './agent.js';
import { OnboardingSequence } from './retention/onboarding.js';
import { WeeklyDigest } from './retention/digest.js';

dotenv.config();

if (!process.env.ANTHROPIC_API_KEY) {
  console.error('[STOREmind] FATAL: ANTHROPIC_API_KEY not set in .env');
  process.exit(1);
}

const app = express();
const httpServer = createServer(app);
app.use(cors());
app.use(express.json());

// ── WebSocket ──────────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server: httpServer });
const clients = new Set();

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const c of clients) { if (c.readyState === 1) c.send(msg); }
}

wss.on('connection', ws => {
  clients.add(ws);
  console.log(`[WS] Client connected — total: ${clients.size}`);

  // Send full state on connect — includes retention data
  ws.send(JSON.stringify({
    type: 'init',
    state: agent.getStatus().state,
    storePatterns: agent.getStatus().storePatterns,
    cycleCount: agent.getStatus().cycleCount,
    stoppedAt: agent.getStatus().stoppedAt,
    timestamp: Date.now(),
  }));

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[WS] Client disconnected — total: ${clients.size}`);
  });

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.command === 'start_agent')     agent.start(msg.interval);
      if (msg.command === 'stop_agent')      agent.stop();
      if (msg.command === 'run_cycle')       agent.runCycle();
      if (msg.command === 'get_phantom')     _sendPhantomValue(ws);
      if (msg.command === 'send_digest')     digest.send().then(d => { if (d) broadcast(d); });
    } catch (e) { console.error('[WS] Parse error:', e.message); }
  });
});

function _sendPhantomValue(ws) {
  const stoppedAt = agent.getStatus().stoppedAt;
  if (!stoppedAt) return;
  const pausedMs = Date.now() - stoppedAt;
  const phantom = agent.getPhantomValue(pausedMs);
  const msg = JSON.stringify({ type: 'phantom_value', phantom, timestamp: Date.now() });
  ws.send(msg);
}

// ── Retention: Pillar 1 — hook first cycle ─────────────────────────────────
const onboarding = new OnboardingSequence();
agent.onFirstCycle = (stats) => {
  console.log('[Retention] First cycle — triggering onboarding sequence');
  onboarding.onFirstCycle(stats);
  broadcast({ type: 'first_cycle', stats, timestamp: Date.now() });
};

// ── Retention: Pillar 2 — weekly digest ───────────────────────────────────
const digest = new WeeklyDigest(() => agent.getStatus());
digest.start();

// ── Retention: Pillar 5 — 30-day guarantee check ──────────────────────────
setTimeout(() => {
  const stats = agent.getStatus();
  const totalProtected = (stats.state?.metrics?.revenueInfluenced || 0) +
                         (stats.state?.metrics?.cartsRecovered || 0) * 85;
  onboarding.onGuaranteeCheck(totalProtected);
  broadcast({ type: 'guarantee_check', totalProtected, timestamp: Date.now() });
}, 30 * 24 * 60 * 60 * 1000);

// ── REST API ───────────────────────────────────────────────────────────────
app.get('/health',      (_, res) => res.json({ status: 'ok', agent: agent.getStatus() }));
app.get('/api/state',   (_, res) => res.json(agent.getStatus()));
app.get('/api/actions', (req, res) => res.json(agent.getStatus().state.recentActions.slice(0, parseInt(req.query.limit ?? '20'))));

app.post('/api/agent/start', (req, res) => { agent.start(req.body?.interval); res.json({ success: true }); });
app.post('/api/agent/stop',  (_, res)   => { agent.stop(); res.json({ success: true }); });
app.post('/api/agent/run',   (_, res)   => { agent.runCycle(); res.json({ success: true }); });

// Retention endpoints
app.get('/api/retention/phantom', (_, res) => {
  const stoppedAt = agent.getStatus().stoppedAt;
  if (!stoppedAt) return res.json({ paused: false });
  const pausedMs = Date.now() - stoppedAt;
  res.json({ paused: true, pausedMs, phantom: agent.getPhantomValue(pausedMs) });
});

app.get('/api/retention/patterns', (_, res) => {
  res.json(agent.getStatus().storePatterns);
});

app.post('/api/retention/signal', (req, res) => {
  // Pillar 4: receive churn signals from dashboard
  const { signal, context } = req.body ?? {};
  console.log(`[Retention] Churn signal: ${signal}`, context ?? '');
  // Future: persist to DB, trigger intervention workflows
  res.json({ received: true, signal });
});

app.post('/api/retention/digest/send', async (_, res) => {
  const result = await digest.send();
  broadcast({ type: 'weekly_digest_sent', timestamp: Date.now() });
  res.json({ success: true, result });
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
  if (!store || !token?.startsWith('shpat_')) return res.status(400).json({ error: 'Invalid credentials' });
  try {
    const r = await fetch(`https://${store}.myshopify.com/admin/api/2024-01/shop.json`, { headers: { 'X-Shopify-Access-Token': token } });
    if (!r.ok) throw new Error(`Shopify ${r.status}`);
    const { shop } = await r.json();
    // Pillar 1: estimate recoverable value for setup projection
    const estimatedMonthlyOrders = 200;
    const estimatedAbandonRate = 0.68;
    const estimatedAvgCart = 85;
    const recoverable = Math.round(estimatedMonthlyOrders * estimatedAbandonRate * estimatedAvgCart * 0.12);
    res.json({ shopName: shop.name, plan: shop.plan_name, estimatedRecoverable: recoverable });
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

// ── Start ──────────────────────────────────────────────────────────────────
const agent = new STOREmindAgent(broadcast);
const PORT  = parseInt(process.env.PORT ?? '3001');

httpServer.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════╗\n║  STOREmind Backend v2.0          ║\n║  HTTP : http://localhost:${PORT}    ║\n║  WS   : ws://localhost:${PORT}     ║\n║  Retention layer: ACTIVE          ║\n╚══════════════════════════════════╝\n`);
  if (process.env.AUTO_START === 'true') agent.start();
});

process.on('SIGINT', () => {
  console.log('\n[STOREmind] Shutting down...');
  digest.stop();
  agent.stop();
  process.exit(0);
});
