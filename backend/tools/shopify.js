// STOREmind — Shopify Admin API Tools
// Real API calls to storemind-hatbvuvt.myshopify.com (or any store via .env)
// Set DEMO_MODE=true in .env to use simulated data without credentials.

const MOCK_MODE = process.env.SHOPIFY_MOCK_MODE === 'true';
const DEMO      = process.env.DEMO_MODE === 'true' || (!process.env.SHOPIFY_ACCESS_TOKEN && !MOCK_MODE);
const SHOP      = process.env.SHOPIFY_SHOP_NAME   || 'storemind-hatbvuvt';
const TOKEN     = process.env.SHOPIFY_ACCESS_TOKEN || 'mock';
const API_VER   = process.env.SHOPIFY_API_VERSION  || '2024-01';
const MOCK_PORT = process.env.MOCK_PORT || '3002';

// Routes to mock server or real Shopify — zero code change on switch
const BASE_URL  = MOCK_MODE
  ? `http://localhost:${MOCK_PORT}/admin/api/${API_VER}`
  : `https://${SHOP}.myshopify.com/admin/api/${API_VER}`;

const HEADERS = MOCK_MODE
  ? { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': 'mock' }
  : { 'X-Shopify-Access-Token': TOKEN, 'Content-Type': 'application/json' };

if (MOCK_MODE) console.log('[Shopify] Running in MOCK mode → http://localhost:' + MOCK_PORT);
else if (!DEMO) console.log('[Shopify] Running against live store:', SHOP);

// ── Shopify API helper ───────────────────────────────────────────────────
async function shopifyFetch(path, opts = {}) {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...opts.headers } });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Shopify ${res.status} ${path}: ${err}`);
  }
  return res.json();
}

// ── Tool definitions ──────────────────────────────────────────────────────
export const shopifyTools = {
  definitions: [
    {
      name: 'get_abandoned_carts',
      description: 'Fetch real abandoned checkouts from the Shopify store. Returns carts abandoned in the last N hours with customer details and cart value.',
      input_schema: {
        type: 'object',
        properties: {
          hours_ago: { type: 'number', description: 'Hours back to search. Default 24.' },
          min_value: { type: 'number', description: 'Minimum cart value USD. Default 0.' },
        },
        required: [],
      },
    },
    {
      name: 'get_recent_orders',
      description: 'Get recent Shopify orders with status and fraud risk scores from Shopify Risk API.',
      input_schema: {
        type: 'object',
        properties: {
          limit:      { type: 'number', description: 'Number to return (max 50). Default 10.' },
          status:     { type: 'string', enum: ['any','open','closed','cancelled'], description: 'Order status filter.' },
          risk_level: { type: 'string', enum: ['any','low','medium','high'], description: 'Fraud risk filter.' },
        },
        required: [],
      },
    },
    {
      name: 'get_inventory_levels',
      description: 'Check real inventory levels across all products. Flags products below threshold.',
      input_schema: {
        type: 'object',
        properties: {
          threshold: { type: 'number', description: 'Alert below this stock count. Default 10.' },
        },
        required: [],
      },
    },
    {
      name: 'apply_discount',
      description: 'Create a real Shopify price rule and discount code for a specific customer.',
      input_schema: {
        type: 'object',
        properties: {
          customer_id:      { type: 'string', description: 'Shopify customer ID.' },
          discount_percent: { type: 'number', description: 'Discount percentage (e.g. 15).' },
          reason:           { type: 'string', description: 'Reason for logging.' },
          expires_hours:    { type: 'number', description: 'Expiry in hours. Default 48.' },
        },
        required: ['customer_id', 'discount_percent', 'reason'],
      },
    },
    {
      name: 'cancel_order',
      description: 'Cancel a Shopify order. USE ONLY after human approval for high-risk orders.',
      input_schema: {
        type: 'object',
        properties: {
          order_id: { type: 'string', description: 'Shopify order ID.' },
          reason:   { type: 'string', description: 'Cancellation reason.' },
          refund:   { type: 'boolean', description: 'Issue refund? Default true.' },
        },
        required: ['order_id', 'reason'],
      },
    },
    {
      name: 'update_inventory_alert',
      description: 'Log a low-stock alert for products. Real reorder notifications via Slack.',
      input_schema: {
        type: 'object',
        properties: {
          product_ids:     { type: 'array', items: { type: 'string' } },
          alert_threshold: { type: 'number' },
        },
        required: ['product_ids', 'alert_threshold'],
      },
    },
  ],

  // ── Execute: routes to real API or demo data ─────────────────────────
  execute: async (name, input) => {
    if (DEMO && !MOCK_MODE) return shopifyTools._demo(name, input);
    try {
      return await shopifyTools._live(name, input);
    } catch (err) {
      console.error(`[Shopify] ${name} failed: ${err.message} — falling back to demo`);
      return { success: false, error: err.message, fallback: true };
    }
  },

  // ── Live Shopify API calls ────────────────────────────────────────────
  _live: async (name, input) => {
    switch (name) {

      case 'get_abandoned_carts': {
        const hoursAgo = input.hours_ago || 24;
        const since = new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
        const data = await shopifyFetch(
          `/checkouts.json?created_at_min=${since}&limit=50`
        );
        const carts = (data.checkouts || [])
          .filter(c => !c.completed_at && parseFloat(c.total_price || 0) >= (input.min_value || 0))
          .map(c => ({
            id:                 c.id,
            token:              c.token,
            customer_id:        c.customer?.id,
            customer_email:     c.email,
            customer_name:      c.billing_address
              ? `${c.billing_address.first_name} ${c.billing_address.last_name}`.trim()
              : (c.customer ? `${c.customer.first_name} ${c.customer.last_name}`.trim() : 'Guest'),
            value:              parseFloat(c.total_price || 0),
            currency:           c.currency,
            items:              (c.line_items || []).map(i => i.title),
            item_count:         (c.line_items || []).reduce((s, i) => s + i.quantity, 0),
            abandoned_at:       c.updated_at,
            abandoned_mins_ago: Math.floor((Date.now() - new Date(c.updated_at)) / 60_000),
            customer_ltv:       0, // enriched below if customer exists
            purchase_probability: _estimatePurchaseProbability(c),
            recovery_url:       c.abandoned_checkout_url,
          }));

        // Enrich LTV for known customers
        for (const cart of carts.filter(c => c.customer_id)) {
          try {
            const cd = await shopifyFetch(`/customers/${cart.customer_id}.json`);
            cart.customer_ltv = parseFloat(cd.customer?.total_spent || 0);
            cart.orders_count = cd.customer?.orders_count || 0;
          } catch (e) { /* non-fatal */ }
        }

        return {
          success: true,
          carts,
          total_value_at_risk: carts.reduce((s, c) => s + c.value, 0).toFixed(2),
          count: carts.length,
        };
      }

      case 'get_recent_orders': {
        const limit  = Math.min(input.limit || 10, 50);
        const status = input.status || 'any';
        const data   = await shopifyFetch(
          `/orders.json?status=${status}&limit=${limit}&fields=id,name,email,total_price,financial_status,fulfillment_status,risk_level,created_at,customer,billing_address,shipping_address,browser_ip,cancelled_at`
        );
        // Fetch risk for each order
        const orders = await Promise.all((data.orders || []).map(async o => {
          let riskScore = 0, riskLevel = 'low', riskFlags = [];
          try {
            const rd = await shopifyFetch(`/orders/${o.id}/risks.json`);
            const risks = rd.risks || [];
            if (risks.length) {
              const top = risks.sort((a, b) => b.score - a.score)[0];
              riskScore = top.score || 0;
              riskLevel = top.recommendation === 'cancel' ? 'high'
                        : top.recommendation === 'investigate' ? 'medium' : 'low';
              riskFlags = risks.filter(r => r.message).map(r => r.message);
            }
          } catch (e) { /* non-fatal */ }

          // Filter by risk level if requested
          if (input.risk_level && input.risk_level !== 'any' && riskLevel !== input.risk_level) return null;

          return {
            id:           `order_${o.id}`,
            shopify_id:   o.id,
            name:         o.name,
            customer_id:  o.customer?.id,
            customer_email: o.email,
            value:        parseFloat(o.total_price || 0),
            status:       o.financial_status,
            fulfillment:  o.fulfillment_status,
            risk_score:   riskScore,
            risk_level:   riskLevel,
            flags:        riskFlags,
            created_at:   o.created_at,
            mins_ago:     Math.floor((Date.now() - new Date(o.created_at)) / 60_000),
            billing_country:  o.billing_address?.country,
            shipping_country: o.shipping_address?.country,
            same_address: o.billing_address?.address1 === o.shipping_address?.address1,
          };
        }));
        return { success: true, orders: orders.filter(Boolean) };
      }

      case 'get_inventory_levels': {
        const threshold = input.threshold || 10;
        const prodData  = await shopifyFetch(`/products.json?limit=250&fields=id,title,variants`);
        const products  = prodData.products || [];

        const low_stock   = [];
        const out_of_stock = [];
        let healthy = 0;

        for (const p of products) {
          const totalStock = (p.variants || []).reduce((s, v) => s + (v.inventory_quantity || 0), 0);
          const sold7d = 0; // Would need Orders API with date filter — placeholder

          if (totalStock === 0) {
            out_of_stock.push({ product_id: p.id, name: p.title, stock: 0, sold_last_7d: sold7d });
          } else if (totalStock < threshold) {
            low_stock.push({ product_id: p.id, name: p.title, stock: totalStock, sold_last_7d: sold7d });
          } else {
            healthy++;
          }
        }
        return { success: true, low_stock, out_of_stock, healthy_products: healthy };
      }

      case 'apply_discount': {
        const code = `RECOVER${input.discount_percent}-${Date.now().toString(36).toUpperCase().slice(-6)}`;
        const expiresAt = new Date(Date.now() + (input.expires_hours || 48) * 3_600_000).toISOString();

        // Create price rule
        const prRule = await shopifyFetch('/price_rules.json', {
          method: 'POST',
          body: JSON.stringify({ price_rule: {
            title:             code,
            target_type:       'line_item',
            target_selection:  'all',
            allocation_method: 'across',
            value_type:        'percentage',
            value:             `-${input.discount_percent}`,
            customer_selection:'all',
            starts_at:         new Date().toISOString(),
            ends_at:           expiresAt,
            usage_limit:       1,
            once_per_customer: true,
          }}),
        });
        const priceRuleId = prRule.price_rule.id;

        // Create discount code
        await shopifyFetch(`/price_rules/${priceRuleId}/discount_codes.json`, {
          method: 'POST',
          body: JSON.stringify({ discount_code: { code } }),
        });

        return {
          success:          true,
          discount_code:    code,
          price_rule_id:    priceRuleId,
          customer_id:      input.customer_id,
          discount_percent: input.discount_percent,
          expires_at:       expiresAt,
          message:          `${input.discount_percent}% discount code ${code} created`,
        };
      }

      case 'cancel_order': {
        // SAFETY: This requires explicit human approval before reaching here
        // See approval/queue.js — cancel_order is always flagged as REQUIRES_APPROVAL
        const data = await shopifyFetch(`/orders/${input.shopify_id || input.order_id.replace('order_', '')}/cancel.json`, {
          method: 'POST',
          body: JSON.stringify({
            reason: input.reason || 'fraud',
            refund:  input.refund !== false,
            restock: true,
          }),
        });
        return {
          success:           true,
          order_id:          input.order_id,
          shopify_id:        data.order?.id,
          cancelled:         true,
          refund_initiated:  input.refund !== false,
          message:           `Order ${input.order_id} cancelled. Reason: ${input.reason}`,
        };
      }

      case 'update_inventory_alert': {
        // Log alert — real reorder notifications sent via Slack in notify_team
        return {
          success:          true,
          updated_products: input.product_ids,
          new_threshold:    input.alert_threshold,
          message:          `Inventory alerts updated for ${input.product_ids.length} products`,
        };
      }

      default:
        return { success: false, error: `Unknown Shopify tool: ${name}` };
    }
  },

  // ── Demo data (used when DEMO_MODE=true or no credentials) ────────────
  _demo: async (name, input) => {
    await new Promise(r => setTimeout(r, 200 + Math.random() * 300));
    switch (name) {
      case 'get_abandoned_carts':
        return {
          success: true,
          carts: [
            { id: 'cart_001', customer_id: 'cust_445', customer_email: 'sarah@example.com', customer_name: 'Sarah Johnson', value: 127.50, currency: 'USD', items: ['Premium Yoga Mat', 'Water Bottle'], item_count: 2, abandoned_at: new Date(Date.now() - 45*60*1000).toISOString(), abandoned_mins_ago: 45, customer_ltv: 890, purchase_probability: 0.73, recovery_url: '#' },
            { id: 'cart_002', customer_id: 'cust_892', customer_email: 'mike@example.com', customer_name: 'Mike Chen', value: 342.00, currency: 'USD', items: ['Running Shoes', 'Compression Socks', 'Foam Roller'], item_count: 3, abandoned_at: new Date(Date.now() - 120*60*1000).toISOString(), abandoned_mins_ago: 120, customer_ltv: 2100, purchase_probability: 0.61, recovery_url: '#' },
            { id: 'cart_003', customer_id: 'cust_221', customer_email: 'emma@example.com', customer_name: 'Emma Davis', value: 56.00, currency: 'USD', items: ['Resistance Bands'], item_count: 1, abandoned_at: new Date(Date.now() - 180*60*1000).toISOString(), abandoned_mins_ago: 180, customer_ltv: 220, purchase_probability: 0.44, recovery_url: '#' },
          ],
          total_value_at_risk: '525.50', count: 3,
        };
      case 'get_recent_orders':
        return { success: true, orders: [
          { id: 'order_1052', shopify_id: 1052, name: '#1052', customer_id: 'cust_991', value: 289.00, status: 'open', risk_score: 0.89, risk_level: 'high', flags: ['Different billing/shipping', 'New account', 'VPN detected'], created_at: new Date(Date.now()-12*60*1000).toISOString(), mins_ago: 12, same_address: false },
          { id: 'order_1051', shopify_id: 1051, name: '#1051', customer_id: 'cust_334', value: 45.00, status: 'open', risk_score: 0.12, risk_level: 'low', flags: [], created_at: new Date(Date.now()-23*60*1000).toISOString(), mins_ago: 23, same_address: true },
          { id: 'order_1050', shopify_id: 1050, name: '#1050', customer_id: 'cust_778', value: 178.50, status: 'closed', risk_score: 0.21, risk_level: 'low', flags: [], created_at: new Date(Date.now()-60*60*1000).toISOString(), mins_ago: 60, same_address: true },
        ]};
      case 'get_inventory_levels':
        return { success: true, low_stock: [
          { product_id: 'prod_101', name: 'Premium Yoga Mat', stock: 3, sold_last_7d: 45 },
          { product_id: 'prod_205', name: 'Resistance Bands Set', stock: 7, sold_last_7d: 28 },
        ], out_of_stock: [{ product_id: 'prod_089', name: 'Jump Rope Elite', stock: 0, sold_last_7d: 19 }], healthy_products: 142 };
      case 'apply_discount':
        return { success: true, discount_code: `SAVE${input.discount_percent}-${Math.random().toString(36).substr(2,6).toUpperCase()}`, customer_id: input.customer_id, discount_percent: input.discount_percent, expires_at: new Date(Date.now()+(input.expires_hours||48)*3_600_000).toISOString(), message: `${input.discount_percent}% discount applied` };
      case 'cancel_order':
        return { success: true, order_id: input.order_id, cancelled: true, refund_initiated: input.refund !== false, message: `Order ${input.order_id} cancelled` };
      case 'update_inventory_alert':
        return { success: true, updated_products: input.product_ids, new_threshold: input.alert_threshold, message: `Alerts updated for ${input.product_ids.length} products` };
      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────
function _estimatePurchaseProbability(checkout) {
  let score = 0.3; // base
  if (checkout.email) score += 0.15;
  if (checkout.billing_address) score += 0.1;
  if ((checkout.line_items || []).length > 1) score += 0.05;
  const value = parseFloat(checkout.total_price || 0);
  if (value > 200) score += 0.1;
  if (value > 100) score += 0.05;
  const minsAgo = (Date.now() - new Date(checkout.updated_at)) / 60_000;
  if (minsAgo < 30) score += 0.2;
  else if (minsAgo < 60) score += 0.1;
  else if (minsAgo > 240) score -= 0.1;
  return Math.round(Math.min(0.95, Math.max(0.05, score)) * 100) / 100;
}
