// STOREmind — Shopify Webhook Handler
// Receives real-time events from Shopify instead of polling.
// Register webhooks at: /api/webhooks/register
// Webhook endpoint:     POST /webhooks/shopify
import crypto from 'crypto';

const WEBHOOK_SECRET = process.env.SHOPIFY_WEBHOOK_SECRET || '';

// ── Verify Shopify webhook signature ────────────────────────────────────
export function verifyShopifyWebhook(rawBody, hmacHeader) {
  if (!WEBHOOK_SECRET) return true; // skip in dev
  const hash = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(rawBody, 'utf8')
    .digest('base64');
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(hmacHeader || ''));
}

// ── Map Shopify topics → agent-friendly events ───────────────────────────
export function webhookToEvent(topic, payload) {
  switch (topic) {

    case 'checkouts/create':
    case 'checkouts/update': {
      const c = payload;
      if (c.completed_at) return null; // completed checkout — ignore
      return {
        type:    'cart_event',
        subtype: topic,
        data: {
          id:               c.id,
          token:            c.token,
          customer_email:   c.email,
          customer_name:    c.billing_address
            ? `${c.billing_address.first_name} ${c.billing_address.last_name}`.trim()
            : 'Guest',
          value:            parseFloat(c.total_price || 0),
          items:            (c.line_items || []).map(i => i.title),
          abandoned_at:     c.updated_at,
          recovery_url:     c.abandoned_checkout_url,
        },
      };
    }

    case 'orders/create': {
      const o = payload;
      return {
        type: 'order_created',
        data: {
          id:          o.id,
          name:        o.name,
          value:       parseFloat(o.total_price || 0),
          email:       o.email,
          customer_id: o.customer?.id,
          created_at:  o.created_at,
        },
      };
    }

    case 'orders/cancelled': {
      return { type: 'order_cancelled', data: { id: payload.id, name: payload.name, reason: payload.cancel_reason } };
    }

    case 'inventory_levels/update': {
      return {
        type: 'inventory_update',
        data: {
          inventory_item_id: payload.inventory_item_id,
          location_id:       payload.location_id,
          available:         payload.available,
        },
      };
    }

    case 'refunds/create': {
      return { type: 'refund_created', data: { order_id: payload.order_id, amount: payload.transactions?.[0]?.amount } };
    }

    default:
      return { type: 'shopify_event', topic, data: payload };
  }
}

// ── Register webhooks with Shopify ───────────────────────────────────────
export async function registerWebhooks(shopName, accessToken, callbackBaseUrl) {
  const topics = [
    'checkouts/create',
    'checkouts/update',
    'orders/create',
    'orders/cancelled',
    'inventory_levels/update',
    'refunds/create',
  ];

  const BASE = `https://${shopName}.myshopify.com/admin/api/2024-01`;
  const HDRS = { 'X-Shopify-Access-Token': accessToken, 'Content-Type': 'application/json' };

  const results = [];
  for (const topic of topics) {
    try {
      const r = await fetch(`${BASE}/webhooks.json`, {
        method: 'POST', headers: HDRS,
        body: JSON.stringify({ webhook: {
          topic,
          address: `${callbackBaseUrl}/webhooks/shopify`,
          format: 'json',
        }}),
      });
      const d = await r.json();
      if (d.webhook) {
        results.push({ topic, id: d.webhook.id, status: 'registered' });
        console.log(`[Webhooks] Registered: ${topic}`);
      } else {
        results.push({ topic, status: 'failed', error: JSON.stringify(d.errors) });
      }
    } catch (e) {
      results.push({ topic, status: 'error', error: e.message });
    }
  }
  return results;
}
