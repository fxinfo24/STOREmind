// STOREmind — Shopify Admin API Mock Server
// Mirrors the real Shopify Admin REST API exactly.
// Run alongside backend: node mock/shopify-mock.js
// Set SHOPIFY_MOCK_MODE=true in .env to route all API calls here.
//
// Simulates: abandoned carts, orders with fraud scores, inventory,
//            price rules, discount codes, customers.
// Fires webhook events to localhost:3001/webhooks/shopify automatically.

import express from 'express';
import dotenv  from 'dotenv';

dotenv.config();

const app  = express();
const PORT = parseInt(process.env.MOCK_PORT || '3002');
const WH_TARGET = `http://localhost:${process.env.PORT || 3001}/webhooks/shopify`;

app.use(express.json());

// ── Seed data — based on real store patterns ──────────────────────────────
const STORE = {
  name: 'STOREmind', email: 'hello@storemind.io',
  domain: 'storemind-hatbvuvt.myshopify.com',
  currency: 'USD', plan_name: 'shopify_plus',
  country: 'US', timezone: 'America/New_York',
};

let customers = [
  { id: 'cust_001', first_name: 'Mojibur', last_name: 'Rahman',  email: 'mojibur@example.com', total_spent: '714.95', orders_count: 1, created_at: new Date(Date.now()-86400000).toISOString() },
  { id: 'cust_002', first_name: 'Sarah',   last_name: 'Johnson', email: 'sarah@example.com',   total_spent: '1240.50', orders_count: 4, created_at: new Date(Date.now()-864000000).toISOString() },
  { id: 'cust_003', first_name: 'Mike',    last_name: 'Chen',    email: 'mike@example.com',    total_spent: '3820.00', orders_count: 12, created_at: new Date(Date.now()-2592000000).toISOString() },
  { id: 'cust_004', first_name: 'Emma',    last_name: 'Davis',   email: 'emma@example.com',    total_spent: '445.00', orders_count: 2, created_at: new Date(Date.now()-1728000000).toISOString() },
  { id: 'cust_005', first_name: 'Alex',    last_name: 'Torres',  email: 'alex@example.com',    total_spent: '89.00', orders_count: 1, created_at: new Date(Date.now()-3600000).toISOString() },
];

// Real abandoned checkout (matches screenshot)
let checkouts = [
  {
    id: 'checkout_hatbvuvt_001', token: 'abc123real',
    email: 'mojibur@example.com',
    customer: customers[0],
    billing_address: { first_name: 'Mojibur', last_name: 'Rahman', country: 'US' },
    shipping_address: { first_name: 'Mojibur', last_name: 'Rahman', country: 'US' },
    line_items: [
      { id: 'li_001', title: 'Premium Fitness Bundle', quantity: 1, price: '499.95' },
      { id: 'li_002', title: 'Resistance Band Set Pro', quantity: 1, price: '215.00' },
    ],
    total_price: '714.95', currency: 'USD',
    created_at: new Date(Date.now() - 3*3600000).toISOString(),
    updated_at: new Date(Date.now() - 25*60000).toISOString(),
    abandoned_checkout_url: `https://storemind-hatbvuvt.myshopify.com/checkouts/abc123real/recover`,
    completed_at: null,
  },
  {
    id: 'checkout_hatbvuvt_002', token: 'def456',
    email: 'sarah@example.com',
    customer: customers[1],
    billing_address: { first_name: 'Sarah', last_name: 'Johnson', country: 'US' },
    shipping_address: { first_name: 'Sarah', last_name: 'Johnson', country: 'US' },
    line_items: [{ id: 'li_003', title: 'Yoga Mat Elite', quantity: 1, price: '127.50' }],
    total_price: '127.50', currency: 'USD',
    created_at: new Date(Date.now() - 1.5*3600000).toISOString(),
    updated_at: new Date(Date.now() - 45*60000).toISOString(),
    abandoned_checkout_url: `https://storemind-hatbvuvt.myshopify.com/checkouts/def456/recover`,
    completed_at: null,
  },
];

let orders = [
  {
    id: 'order_1052', name: '#1052',
    email: 'alex@example.com', customer: customers[4],
    total_price: '289.00', financial_status: 'pending', fulfillment_status: null,
    billing_address:  { address1: '123 Fraud St', country: 'US' },
    shipping_address: { address1: '456 Different Ave', country: 'US' },
    browser_ip: '185.220.101.42', // known Tor exit
    created_at: new Date(Date.now() - 12*60000).toISOString(),
    cancelled_at: null,
  },
  {
    id: 'order_1051', name: '#1051',
    email: 'sarah@example.com', customer: customers[1],
    total_price: '45.00', financial_status: 'paid', fulfillment_status: 'fulfilled',
    billing_address:  { address1: '10 Main St', country: 'US' },
    shipping_address: { address1: '10 Main St', country: 'US' },
    browser_ip: '73.184.22.111',
    created_at: new Date(Date.now() - 2*3600000).toISOString(),
    cancelled_at: null,
  },
];

let products = [
  { id: 'prod_101', title: 'Premium Yoga Mat', variants: [{ id: 'var_101', inventory_quantity: 3, price: '89.00' }] },
  { id: 'prod_102', title: 'Resistance Bands Set Pro', variants: [{ id: 'var_102', inventory_quantity: 7, price: '45.00' }] },
  { id: 'prod_103', title: 'Foam Roller Elite', variants: [{ id: 'var_103', inventory_quantity: 2, price: '38.00' }] },
  { id: 'prod_104', title: 'Jump Rope Premium', variants: [{ id: 'var_104', inventory_quantity: 0, price: '22.00' }] },
  { id: 'prod_105', title: 'Premium Fitness Bundle', variants: [{ id: 'var_105', inventory_quantity: 15, price: '499.95' }] },
];

let priceRules = [];
let discountCodes = {};

// ── Middleware: log all requests ──────────────────────────────────────────
app.use((req, _, next) => {
  console.log(`[Mock] ${req.method} ${req.path}`);
  next();
});

// ── Shop ──────────────────────────────────────────────────────────────────
app.get('/admin/api/:version/shop.json', (_, res) => res.json({ shop: STORE }));

// ── Checkouts ─────────────────────────────────────────────────────────────
app.get('/admin/api/:version/checkouts.json', (req, res) => {
  const since = req.query.created_at_min ? new Date(req.query.created_at_min) : null;
  let result  = checkouts.filter(c => !c.completed_at);
  if (since) result = result.filter(c => new Date(c.created_at) >= since);
  res.json({ checkouts: result });
});

app.get('/admin/api/:version/checkouts/:id.json', (req, res) => {
  const c = checkouts.find(c => c.id === req.params.id || c.token === req.params.id);
  if (!c) return res.status(404).json({ errors: 'Not found' });
  res.json({ checkout: c });
});

// ── Orders ────────────────────────────────────────────────────────────────
app.get('/admin/api/:version/orders.json', (req, res) => {
  let result = [...orders];
  if (req.query.status && req.query.status !== 'any') {
    result = result.filter(o => o.financial_status === req.query.status);
  }
  result = result.slice(0, parseInt(req.query.limit || '50'));
  res.json({ orders: result });
});

app.get('/admin/api/:version/orders/:id.json', (req, res) => {
  const o = orders.find(o => String(o.id) === req.params.id);
  if (!o) return res.status(404).json({ errors: 'Not found' });
  res.json({ order: o });
});

app.post('/admin/api/:version/orders/:id/cancel.json', (req, res) => {
  const o = orders.find(o => String(o.id) === req.params.id);
  if (!o) return res.status(404).json({ errors: 'Not found' });
  o.cancelled_at = new Date().toISOString();
  o.financial_status = 'refunded';
  console.log(`[Mock] Order ${o.id} cancelled`);
  // Fire webhook
  _fireWebhook('orders/cancelled', o);
  res.json({ order: o });
});

// ── Order Risks ───────────────────────────────────────────────────────────
app.get('/admin/api/:version/orders/:id/risks.json', (req, res) => {
  const o = orders.find(o => String(o.id) === req.params.id);
  if (!o) return res.json({ risks: [] });
  // Simulate risk scoring
  const isSameAddress = o.billing_address?.address1 === o.shipping_address?.address1;
  const isTorIp = ['185.220', '185.100', '162.247'].some(p => (o.browser_ip || '').startsWith(p));
  const isNewCustomer = (o.customer?.orders_count || 0) <= 1;
  let score = 0.1;
  if (!isSameAddress) score += 0.35;
  if (isTorIp)        score += 0.4;
  if (isNewCustomer)  score += 0.1;
  const recommendation = score > 0.7 ? 'cancel' : score > 0.4 ? 'investigate' : 'accept';
  const risks = [];
  if (!isSameAddress) risks.push({ message: 'Billing and shipping addresses differ', score, recommendation });
  if (isTorIp)        risks.push({ message: 'IP address associated with known anonymiser', score, recommendation });
  if (isNewCustomer)  risks.push({ message: 'New customer account', score: 0.1, recommendation: 'accept' });
  res.json({ risks });
});

// ── Customers ─────────────────────────────────────────────────────────────
app.get('/admin/api/:version/customers.json', (req, res) => res.json({ customers }));

app.get('/admin/api/:version/customers/:id.json', (req, res) => {
  const c = customers.find(c => String(c.id) === req.params.id);
  if (!c) return res.status(404).json({ errors: 'Not found' });
  res.json({ customer: c });
});

// ── Products + Inventory ──────────────────────────────────────────────────
app.get('/admin/api/:version/products.json', (req, res) => res.json({ products }));

app.get('/admin/api/:version/inventory_levels.json', (req, res) => {
  const levels = products.flatMap(p => p.variants.map(v => ({
    inventory_item_id: v.id,
    location_id: 'loc_001',
    available: v.inventory_quantity,
  })));
  res.json({ inventory_levels: levels });
});

// ── Price Rules + Discount Codes ──────────────────────────────────────────
app.post('/admin/api/:version/price_rules.json', (req, res) => {
  const rule = { id: `pr_${Date.now()}`, ...req.body.price_rule, created_at: new Date().toISOString() };
  priceRules.push(rule);
  res.status(201).json({ price_rule: rule });
});

app.post('/admin/api/:version/price_rules/:id/discount_codes.json', (req, res) => {
  const code = { id: `dc_${Date.now()}`, code: req.body.discount_code.code, created_at: new Date().toISOString() };
  if (!discountCodes[req.params.id]) discountCodes[req.params.id] = [];
  discountCodes[req.params.id].push(code);
  res.status(201).json({ discount_code: code });
});

// ── Webhooks registration ─────────────────────────────────────────────────
app.post('/admin/api/:version/webhooks.json', (req, res) => {
  const wh = { id: `wh_${Date.now()}`, ...req.body.webhook, created_at: new Date().toISOString() };
  res.status(201).json({ webhook: wh });
});

// ── Simulation: fire events automatically ─────────────────────────────────
async function _fireWebhook(topic, payload) {
  try {
    await fetch(WH_TARGET, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-shopify-topic': topic, 'x-shopify-hmac-sha256': 'mock' },
      body: JSON.stringify(payload),
    });
    console.log(`[Mock] Webhook fired: ${topic}`);
  } catch (e) { /* backend might not be running */ }
}

// Simulate new cart every 90s (realistic store activity)
setInterval(() => {
  const names = [['Jordan','Lee','jordan@example.com'],['Taylor','Kim','taylor@example.com'],['Casey','Park','casey@example.com']];
  const [fn, ln, email] = names[Math.floor(Math.random() * names.length)];
  const prods = [
    ['Compression Shorts Pro', 68.00], ['Running Shoes Elite', 185.00], ['Water Bottle Insulated', 32.00],
    ['Gym Bag Premium', 95.00], ['Protein Shaker Set', 28.00],
  ];
  const items = [prods[Math.floor(Math.random() * prods.length)]];
  const total = items.reduce((s, [,p]) => s+p, 0);
  const newCart = {
    id: `checkout_sim_${Date.now()}`, token: `sim_${Date.now()}`,
    email, billing_address: { first_name: fn, last_name: ln, country: 'US' },
    shipping_address: { first_name: fn, last_name: ln, country: 'US' },
    line_items: items.map(([title, price]) => ({ title, quantity: 1, price: String(price) })),
    total_price: String(total.toFixed(2)), currency: 'USD',
    created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    abandoned_checkout_url: `https://storemind-hatbvuvt.myshopify.com/checkouts/sim_${Date.now()}/recover`,
    completed_at: null,
  };
  checkouts.push(newCart);
  // Keep max 20 carts
  if (checkouts.length > 20) checkouts = checkouts.filter(c => !c.id.startsWith('checkout_sim_')).concat(checkouts.filter(c => c.id.startsWith('checkout_sim_')).slice(-5));
  _fireWebhook('checkouts/create', newCart);
}, 90_000);

// Simulate new order every 3min
setInterval(() => {
  const id = `order_${1060 + Math.floor(Math.random() * 100)}`;
  const suspicious = Math.random() > 0.8; // 20% fraud rate for demo
  const newOrder = {
    id, name: `#${id.split('_')[1]}`,
    email: suspicious ? `user${Date.now()}@tempmail.org` : 'customer@example.com',
    customer: { id: `cust_sim_${Date.now()}`, orders_count: suspicious ? 1 : 3 },
    total_price: suspicious ? '389.00' : '67.00',
    financial_status: 'pending', fulfillment_status: null,
    billing_address:  { address1: suspicious ? '1 Fraud Ln' : '10 Normal St', country: 'US' },
    shipping_address: { address1: suspicious ? '99 Other Ave' : '10 Normal St', country: 'US' },
    browser_ip: suspicious ? '185.220.101.42' : '73.184.22.111',
    created_at: new Date().toISOString(), cancelled_at: null,
  };
  orders.unshift(newOrder);
  if (orders.length > 50) orders = orders.slice(0, 50);
  _fireWebhook('orders/create', newOrder);
}, 180_000);

app.listen(PORT, () => {
  console.log(`\n╔══════════════════════════════════════╗\n║  STOREmind Mock Shopify API          ║\n║  http://localhost:${PORT}               ║\n║  Mirrors: Admin REST API 2024-01     ║\n║  Real cart: Mojibur Rahman $714.95   ║\n║  Simulates new carts every 90s       ║\n╚══════════════════════════════════════╝\n`);
});
