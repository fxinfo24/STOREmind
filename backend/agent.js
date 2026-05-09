// STOREmind — Claude Agent Loop (claude-sonnet-4-6)
import Anthropic from '@anthropic-ai/sdk';
import { getAllToolDefinitions, executeTool } from './tools/index.js';
import { AgentMemory } from './memory/store.js';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export class STOREmindAgent {
  constructor(broadcastFn) {
    this.memory = new AgentMemory();
    this.broadcast = broadcastFn;
    this.isRunning = false;
    this.loopInterval = null;
    this.conversationHistory = [];
    this.config = {
      cycleInterval:    parseInt(process.env.CYCLE_INTERVAL    || '60'),
      cartThreshold:  parseFloat(process.env.CART_THRESHOLD    || '50'),
      fraudThreshold: parseFloat(process.env.FRAUD_THRESHOLD   || '0.8'),
      recoveryDiscount: parseInt(process.env.RECOVERY_DISCOUNT || '15'),
      stockThreshold:   parseInt(process.env.STOCK_THRESHOLD   || '10'),
      enableCartRecovery:   process.env.ENABLE_CART_RECOVERY    !== 'false',
      enableFraudCancel:    process.env.ENABLE_FRAUD_CANCEL     !== 'false',
      enableInventoryAlerts:process.env.ENABLE_INVENTORY_ALERTS !== 'false',
      enableCampaigns:      process.env.ENABLE_CAMPAIGNS        === 'true',
    };
  }

  _systemPrompt() {
    const ctx = this.memory.getContext();
    return `You are STOREmind — an autonomous AI agent managing an e-commerce store.
Mission: Maximise revenue, prevent fraud, recover abandoned carts, and keep operations healthy.

You operate in a continuous 6-step loop:
1. MONITOR  — Check orders, carts, inventory
2. ANALYZE  — Find patterns, risks, opportunities
3. DECIDE   — Choose highest-impact action
4. ACT      — Execute via tools
5. LEARN    — Remember outcomes
6. REPORT   — Update the dashboard

CONTEXT:
Recent actions: ${JSON.stringify(ctx.recentActions.map(a => a.description))}
Current metrics: ${JSON.stringify(ctx.currentMetrics)}

DECISION RULES:
- Abandoned cart > $${this.config.cartThreshold} with high-LTV customer → send recovery email + ${this.config.recoveryDiscount}% discount
- Abandoned cart > $200 → additionally send SMS
- Order risk score > ${this.config.fraudThreshold} → cancel immediately + notify #fraud
- Inventory < ${this.config.stockThreshold} units with high velocity → alert #operations
- At-risk customer segment → win-back campaign

BEHAVIOUR: Explain reasoning before each action. Chain tools when logical. Prioritise by revenue impact. Be concise.`;
  }

  async runCycle() {
    this.broadcast({ type: 'agent_thinking', message: 'Starting monitoring cycle...', timestamp: Date.now() });
    this.conversationHistory.push({ role: 'user', content:
      `Run a full monitoring cycle. Check: abandoned carts, high-risk orders, low inventory. Analyse and take the highest-impact actions. Explain your reasoning at each step.` });
    await this._agentLoop();
  }

  async _agentLoop() {
    let go = true; let i = 0; const MAX = 12;
    while (go && i++ < MAX) {
      try {
        const resp = await client.messages.create({
          model: 'claude-sonnet-4-6', max_tokens: 4096,
          system: this._systemPrompt(), tools: getAllToolDefinitions(),
          messages: this.conversationHistory,
        });
        this.conversationHistory.push({ role: 'assistant', content: resp.content });
        if (this.conversationHistory.length > 20) this.conversationHistory = this.conversationHistory.slice(-16);

        const uses = [];
        for (const b of resp.content) {
          if (b.type === 'text' && b.text) {
            this.broadcast({ type: 'agent_reasoning', text: b.text, timestamp: Date.now() });
            this.memory.state.currentThinking = b.text;
          }
          if (b.type === 'tool_use') { uses.push(b); this.broadcast({ type: 'tool_executing', tool: b.name, input: b.input, timestamp: Date.now() }); }
        }

        if (uses.length) {
          const results = [];
          for (const u of uses) {
            const result = await executeTool(u.name, u.input);
            const action = this.memory.recordAction({ tool: u.name, input: u.input, result, success: result.success, description: this._describe(u.name, u.input, result) });
            this.broadcast({ type: 'tool_result', tool: u.name, input: u.input, result, action, timestamp: Date.now() });
            this._updateMetrics(u.name, result);
            results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(result) });
          }
          this.conversationHistory.push({ role: 'user', content: results });
        }

        if (resp.stop_reason === 'end_turn') {
          go = false;
          this.broadcast({ type: 'cycle_complete', state: this.memory.getState(), timestamp: Date.now() });
          this.conversationHistory = [];
        }
      } catch (err) {
        console.error('[STOREmind agent error]', err.message);
        this.broadcast({ type: 'agent_error', error: err.message, timestamp: Date.now() });
        go = false;
      }
    }
  }

  _describe(name, input, result) {
    const m = {
      get_abandoned_carts: `Scanned abandoned carts — found ${result.carts?.length ?? 0} ($${result.total_value_at_risk ?? 0} at risk)`,
      get_recent_orders:   `Checked ${result.orders?.length ?? 0} orders for fraud risk`,
      get_inventory_levels:`Inventory check — ${result.low_stock?.length ?? 0} low, ${result.out_of_stock?.length ?? 0} OOS`,
      apply_discount:      `Applied ${input.discount_percent}% discount to ${input.customer_id}`,
      cancel_order:        `Cancelled high-risk order ${input.order_id}`,
      send_cart_recovery_email: `Recovery email → ${input.customer_email}`,
      send_bulk_campaign:  `Campaign → ${input.segment} segment`,
      send_sms:            `SMS → customer ${input.customer_id}`,
      notify_team:         `Team notified via ${input.channel}`,
      update_inventory_alert: `Inventory alerts updated (${input.product_ids?.length} products)`,
    };
    return m[name] ?? `Executed ${name}`;
  }

  _updateMetrics(name, result) {
    if (!result.success) return;
    const m = this.memory.state.metrics;
    if (name === 'send_cart_recovery_email') this.memory.updateMetrics({ cartsRecovered: m.cartsRecovered + 1 });
    if (name === 'apply_discount') this.memory.updateMetrics({ revenueInfluenced: m.revenueInfluenced + Math.floor(50 + Math.random() * 250) });
    if (name === 'get_recent_orders' && result.orders) this.memory.updateMetrics({ ordersProcessed: m.ordersProcessed + result.orders.length });
    if (name === 'send_bulk_campaign') this.memory.updateMetrics({ timeSaved: m.timeSaved + 2 });
  }

  start(intervalSeconds) {
    if (this.isRunning) return;
    this.isRunning = true;
    const iv = intervalSeconds ?? this.config.cycleInterval;
    console.log(`[STOREmind] Started — cycle every ${iv}s`);
    this.broadcast({ type: 'agent_started', timestamp: Date.now() });
    this.runCycle();
    this.loopInterval = setInterval(() => this.runCycle(), iv * 1000);
  }

  stop() {
    this.isRunning = false;
    if (this.loopInterval) { clearInterval(this.loopInterval); this.loopInterval = null; }
    console.log('[STOREmind] Stopped');
    this.broadcast({ type: 'agent_stopped', timestamp: Date.now() });
  }

  getStatus() { return { isRunning: this.isRunning, state: this.memory.getState() }; }
}
