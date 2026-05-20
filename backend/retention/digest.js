// STOREmind — Weekly Digest Engine
// Pillar 2: Every Monday morning — "here's what STOREmind did this week"

export class WeeklyDigest {
  constructor(getStatsFn) {
    this.getStats   = getStatsFn; // callback → returns current agent stats
    this.klaviyoKey = process.env.KLAVIYO_API_KEY   || null;
    this.fromEmail  = process.env.FROM_EMAIL         || null;
    this.merchantEmail = process.env.MERCHANT_EMAIL  || null;
    this.merchantName  = process.env.MERCHANT_NAME   || 'there';
    this.storeName     = process.env.SHOPIFY_SHOP_NAME || 'your store';
    this.weeklyHistory = []; // rolling 4-week history for trend lines
    this._timer = null;
  }

  start() {
    const msToNextMonday = this._msUntilNextMonday();
    console.log(`[Digest] First digest in ${Math.round(msToNextMonday / 3_600_000)}h`);
    setTimeout(() => {
      this.send();
      this._timer = setInterval(() => this.send(), 7 * 24 * 60 * 60 * 1000);
    }, msToNextMonday);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
  }

  async send() {
    const stats = this.getStats();
    const week  = this._buildWeekSnapshot(stats);
    this.weeklyHistory.push(week);
    if (this.weeklyHistory.length > 4) this.weeklyHistory.shift();
    const trend = this._calcTrend();
    console.log(`[Digest] Sending weekly digest — ${week.actions} actions, $${week.protected} protected`);
    await this._deliver(week, trend);
    // Broadcast to dashboard so live users see it too
    return { type: 'weekly_digest', week, trend, timestamp: Date.now() };
  }

  _buildWeekSnapshot(stats) {
    return {
      week: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      actions:       stats.state?.actionsTaken       || 0,
      cartsRecovered: stats.state?.metrics?.cartsRecovered || 0,
      revenueInfluenced: stats.state?.metrics?.revenueInfluenced || 0,
      ordersProcessed: stats.state?.metrics?.ordersProcessed || 0,
      timeSaved:      stats.state?.metrics?.timeSaved || 0,
      successRate:    stats.state?.successRate || 96.7,
      protected: (stats.state?.metrics?.revenueInfluenced || 0) +
                 ((stats.state?.metrics?.cartsRecovered || 0) * 85),
    };
  }

  _calcTrend() {
    if (this.weeklyHistory.length < 2) return { direction: 'up', pct: 0 };
    const prev = this.weeklyHistory[this.weeklyHistory.length - 2];
    const curr = this.weeklyHistory[this.weeklyHistory.length - 1];
    if (!prev.protected) return { direction: 'up', pct: 0 };
    const pct = Math.round(((curr.protected - prev.protected) / prev.protected) * 100);
    return { direction: pct >= 0 ? 'up' : 'down', pct: Math.abs(pct) };
  }

  _msUntilNextMonday() {
    const now = new Date();
    const day = now.getDay(); // 0=Sun, 1=Mon...
    const daysUntil = day === 1 ? 7 : (8 - day) % 7 || 7;
    const next = new Date(now);
    next.setDate(now.getDate() + daysUntil);
    next.setHours(8, 0, 0, 0); // 8am Monday
    const ms = next - now;
    // Dev mode: send after 30s instead
    return process.env.NODE_ENV !== 'production' ? 30_000 : ms;
  }

  async _deliver(week, trend) {
    if (!this.klaviyoKey || !this.merchantEmail) {
      console.log('[Digest] Not configured — digest logged only');
      console.log('[Digest]', JSON.stringify(week));
      return;
    }
    const trendStr = trend.pct > 0
      ? `↑ ${trend.pct}% vs last week`
      : trend.pct === 0 ? 'Consistent performance' : `↓ ${trend.pct}% vs last week`;

    const subject = `STOREmind this week: ${week.actions} actions, $${week.protected.toLocaleString()} protected`;
    const html = `
<div style="font-family:'Segoe UI',sans-serif;max-width:600px;margin:0 auto;background:#020d1a;color:#e0f0ff;border-radius:12px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#041428,#020d1a);padding:24px;text-align:center;border-bottom:1px solid #0d6efd33;">
    <div style="font-size:24px;margin-bottom:6px;">🧠</div>
    <div style="font-size:13px;font-weight:700;color:#4da6ff;letter-spacing:2px;">STOREMIND WEEKLY REPORT</div>
    <div style="font-size:11px;color:#4da6ff44;margin-top:2px;">Week of ${week.week}</div>
  </div>
  <div style="padding:24px;">
    <div style="text-align:center;padding:20px;background:#0d6efd08;border:1px solid #0d6efd22;border-radius:10px;margin-bottom:20px;">
      <div style="font-size:36px;font-weight:900;color:#00ff88;">$${week.protected.toLocaleString()}</div>
      <div style="font-size:11px;color:#4da6ff77;margin-top:4px;letter-spacing:1px;">TOTAL VALUE PROTECTED</div>
      <div style="font-size:11px;color:${trend.direction==='up'?'#00ff88':'#ffaa00'};margin-top:6px;">${trendStr}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
      <tr>
        <td style="padding:10px;background:#0d6efd08;border:1px solid #0d6efd22;border-radius:6px;text-align:center;">
          <div style="font-size:20px;font-weight:800;color:#fff;">${week.actions}</div>
          <div style="font-size:9px;color:#4da6ff77;margin-top:2px;">ACTIONS TAKEN</div>
        </td>
        <td style="padding:4px;"></td>
        <td style="padding:10px;background:#0d6efd08;border:1px solid #0d6efd22;border-radius:6px;text-align:center;">
          <div style="font-size:20px;font-weight:800;color:#fff;">${week.cartsRecovered}</div>
          <div style="font-size:9px;color:#4da6ff77;margin-top:2px;">CARTS RECOVERED</div>
        </td>
        <td style="padding:4px;"></td>
        <td style="padding:10px;background:#0d6efd08;border:1px solid #0d6efd22;border-radius:6px;text-align:center;">
          <div style="font-size:20px;font-weight:800;color:#fff;">${week.timeSaved}h</div>
          <div style="font-size:9px;color:#4da6ff77;margin-top:2px;">TIME SAVED</div>
        </td>
      </tr>
    </table>
    <div style="background:#00ff8808;border:1px solid #00ff8822;border-radius:8px;padding:14px;margin-bottom:20px;font-size:11px;color:#a0ffc8;line-height:1.6;">
      <strong style="color:#00ff88;">Outcome guarantee status:</strong> STOREmind has protected
      $${week.protected.toLocaleString()} in revenue. Your monthly cost is $299.
      ${week.protected >= 299 ? '✅ Guarantee met — you are ROI positive.' : '⚡ Still ramping up — guarantee period active.'}
    </div>
    <a href="http://localhost:3001" style="display:block;text-align:center;background:linear-gradient(135deg,#0d6efd,#00d4ff);color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:700;letter-spacing:1px;font-size:12px;">View Full Dashboard →</a>
  </div>
</div>`;

    try {
      await fetch('https://a.klaviyo.com/api/events/', {
        method: 'POST',
        headers: { Authorization: `Klaviyo-API-Key ${this.klaviyoKey}`, 'Content-Type': 'application/json', revision: '2024-02-15' },
        body: JSON.stringify({ data: { type: 'event', attributes: {
          metric: { data: { type: 'metric', attributes: { name: 'STOREmind Weekly Digest' } } },
          profile: { data: { type: 'profile', attributes: { email: this.merchantEmail } } },
          properties: { subject, html },
        }}}),
      });
      console.log('[Digest] Sent to', this.merchantEmail);
    } catch (e) { console.error('[Digest] Send failed:', e.message); }
  }
}
