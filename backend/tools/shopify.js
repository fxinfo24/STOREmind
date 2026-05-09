// STOREmind — Shopify Tools
// Replace execute() stubs with real Shopify Admin API calls when live.
const delay = ms => new Promise(r => setTimeout(r, ms));

export const shopifyTools = {
  definitions: [
    { name: 'get_abandoned_carts', description: 'Fetch abandoned carts from the last N hours.',
      input_schema: { type: 'object', properties: { hours_ago: { type: 'number', description: 'Hours back. Default 24.' }, min_value: { type: 'number', description: 'Min cart value USD. Default 0.' } }, required: [] } },
    { name: 'get_recent_orders', description: 'Get recent orders with risk scores.',
      input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'Max 50. Default 10.' }, status: { type: 'string', enum: ['any','open','closed','cancelled'] }, risk_level: { type: 'string', enum: ['any','low','medium','high'] } }, required: [] } },
    { name: 'get_inventory_levels', description: 'Check inventory. Flags products below threshold.',
      input_schema: { type: 'object', properties: { threshold: { type: 'number', description: 'Alert below this. Default 10.' } }, required: [] } },
    { name: 'apply_discount', description: 'Apply a discount to a customer.',
      input_schema: { type: 'object', properties: { customer_id: { type: 'string' }, discount_percent: { type: 'number' }, reason: { type: 'string' }, expires_hours: { type: 'number', description: 'Default 48.' } }, required: ['customer_id','discount_percent','reason'] } },
    { name: 'cancel_order', description: 'Cancel a high-risk or fraudulent order.',
      input_schema: { type: 'object', properties: { order_id: { type: 'string' }, reason: { type: 'string' }, refund: { type: 'boolean', description: 'Default true.' } }, required: ['order_id','reason'] } },
    { name: 'update_inventory_alert', description: 'Set low-stock alert thresholds.',
      input_schema: { type: 'object', properties: { product_ids: { type: 'array', items: { type: 'string' } }, alert_threshold: { type: 'number' } }, required: ['product_ids','alert_threshold'] } },
  ],

  execute: async (name, input) => {
    await delay(200 + Math.random() * 300);
    switch (name) {
      case 'get_abandoned_carts': return { success: true, carts: [
        { id: 'cart_001', customer_id: 'cust_445', customer_email: 'sarah@example.com', customer_name: 'Sarah Johnson', value: 127.50, items: ['Premium Yoga Mat','Water Bottle'], abandoned_at: '45 minutes ago', customer_ltv: 890, purchase_probability: 0.73 },
        { id: 'cart_002', customer_id: 'cust_892', customer_email: 'mike@example.com', customer_name: 'Mike Chen', value: 342.00, items: ['Running Shoes','Compression Socks','Foam Roller'], abandoned_at: '2 hours ago', customer_ltv: 2100, purchase_probability: 0.61 },
        { id: 'cart_003', customer_id: 'cust_221', customer_email: 'emma@example.com', customer_name: 'Emma Davis', value: 56.00, items: ['Resistance Bands'], abandoned_at: '3 hours ago', customer_ltv: 220, purchase_probability: 0.44 },
      ], total_value_at_risk: 525.50 };

      case 'get_recent_orders': return { success: true, orders: [
        { id: 'order_1052', customer_id: 'cust_991', value: 289.00, status: 'open', risk_score: 0.89, risk_level: 'high', flags: ['Different billing/shipping','New account','High value','VPN detected'], created_at: '12 minutes ago' },
        { id: 'order_1051', customer_id: 'cust_334', value: 45.00, status: 'open', risk_score: 0.12, risk_level: 'low', flags: [], created_at: '23 minutes ago' },
        { id: 'order_1050', customer_id: 'cust_778', value: 178.50, status: 'closed', risk_score: 0.21, risk_level: 'low', flags: [], created_at: '1 hour ago' },
      ]};

      case 'get_inventory_levels': return { success: true,
        low_stock: [
          { product_id: 'prod_101', name: 'Premium Yoga Mat', stock: 3, sold_last_7d: 45 },
          { product_id: 'prod_205', name: 'Resistance Bands Set', stock: 7, sold_last_7d: 28 },
          { product_id: 'prod_334', name: 'Foam Roller Pro', stock: 2, sold_last_7d: 31 },
        ],
        out_of_stock: [{ product_id: 'prod_089', name: 'Jump Rope Elite', sold_last_7d: 19 }],
        healthy_products: 142 };

      case 'apply_discount': return { success: true,
        discount_code: `SAVE${input.discount_percent}-${Math.random().toString(36).substr(2,6).toUpperCase()}`,
        customer_id: input.customer_id, discount_percent: input.discount_percent,
        expires_at: new Date(Date.now() + (input.expires_hours||48)*3_600_000).toISOString(),
        message: `${input.discount_percent}% discount applied` };

      case 'cancel_order': return { success: true, order_id: input.order_id, cancelled: true,
        refund_initiated: input.refund !== false, message: `Order ${input.order_id} cancelled. Reason: ${input.reason}` };

      case 'update_inventory_alert': return { success: true, updated_products: input.product_ids,
        new_threshold: input.alert_threshold, message: `Alerts updated for ${input.product_ids.length} products` };

      default: return { success: false, error: `Unknown tool: ${name}` };
    }
  },
};
