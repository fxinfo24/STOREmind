# STOREmind

**Autonomous Store Intelligence Platform** — an AI agent powered by Claude Sonnet 4.6
that monitors, analyzes, decides, and acts on your Shopify store 24/7.

## Architecture

```
STOREmind/
├── frontend/
│   ├── dashboard.html   # Live agent dashboard (WebSocket + demo fallback)
│   └── setup.html       # 6-step setup wizard
└── backend/
    ├── server.js        # Express + WebSocket server
    ├── agent.js         # Claude agent loop (6-step cycle)
    ├── memory/
    │   └── store.js     # Agent state + long-term memory
    └── tools/
        ├── index.js     # Tool registry
        ├── shopify.js   # Shopify Admin API tools
        └── klaviyo.js   # Klaviyo email/SMS + Slack tools
```

## Agent Loop (6 Steps)

```
MONITOR → ANALYZE → DECIDE → ACT → LEARN → REPORT
```

Every cycle Claude:
1. Scans abandoned carts, recent orders (with fraud scoring), inventory
2. Analyzes patterns and identifies highest-impact opportunities
3. Decides: recovery email, discount, order cancellation, or team alert
4. Executes via Shopify / Klaviyo / Slack tools
5. Records outcomes in agent memory to improve future decisions
6. Pushes live updates to the dashboard via WebSocket

## Quick Start

```bash
cd backend
cp .env.example .env
# Fill in ANTHROPIC_API_KEY, Shopify, Klaviyo, Slack
npm install
npm start
```

Then open `frontend/setup.html` in your browser to configure, or `frontend/dashboard.html` directly (demo mode if backend is offline).

## Integration Points

| Service | Tools |
|---------|-------|
| Shopify | get_abandoned_carts, get_recent_orders, get_inventory_levels, apply_discount, cancel_order |
| Klaviyo | send_cart_recovery_email, send_bulk_campaign, send_sms |
| Slack   | notify_team (#alerts, #fraud, #operations) |

## Configuration (via .env)

| Key | Default | Description |
|-----|---------|-------------|
| CYCLE_INTERVAL | 60 | Seconds between monitoring cycles |
| CART_THRESHOLD | 50 | Min cart value ($) to trigger recovery |
| FRAUD_THRESHOLD | 0.8 | Risk score above which orders are cancelled |
| RECOVERY_DISCOUNT | 15 | Discount % sent with cart recovery emails |
| STOCK_THRESHOLD | 10 | Units below which inventory alerts fire |
| AUTO_START | false | Start agent automatically on server launch |

## Security Notes

- Never commit `.env` to git — it's in `.gitignore`
- Shopify token requires: `read_orders write_orders read_customers write_customers read_products write_discounts`
- All tool executions are logged to agent memory and visible in the dashboard
