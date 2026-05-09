// STOREmind — Express + WebSocket Server
import express from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import cors from 'cors';
import dotenv from 'dotenv';
import { STOREmindAgent } from './agent.js';

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
  ws.send(JSON.stringify({ type: 'init', state: agent.getStatus().state, timestamp: Date.now() }));
  ws.on('close', () => { clients.delete(ws); console.log(`[WS] Client disconnected — total: ${clients.size}`); });
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.command === 'start_agent') agent.start(msg.interval);
      if (msg.command === 'stop_agent')  agent.stop();
      if (msg.command === 'run_cycle')   agent.runCycle();
    } catch (e) { console.error('[WS] Parse error:', e.message); }
  });
});

// ── REST API ───────────────────────────────────────────────────────────────
app.get('/health',       (_, res) => res.json({ status: 'ok', agent: agent.getStatus() }));
app.get('/api/state',    (_, res) => res.json(agent.getStatus()));
app.get('/api/actions',  (req, res) => res.json(agent.getStatus().state.recentActions.slice(0, parseInt(req.query.limit ?? '20'))));
app.post('/api/agent/start', (req, res) => { agent.start(req.body?.interval); res.json({ success: true }); });
app.post('/api/agent/stop',  (_, res)   => { agent.stop(); res.json({ success: true }); });
app.post('/api/agent/run',   (_, res)   => { agent.runCycle(); res.json({ success: true }); });

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
    res.json({ shopName: shop.name, plan: shop.plan_name });
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
  console.log(`\n╔══════════════════════════════╗\n║  STOREmind Backend v1.0      ║\n║  HTTP: http://localhost:${PORT}  ║\n║  WS  : ws://localhost:${PORT}   ║\n╚══════════════════════════════╝\n`);
  if (process.env.AUTO_START === 'true') agent.start();
});

process.on('SIGINT', () => { console.log('\n[STOREmind] Shutting down...'); agent.stop(); process.exit(0); });
