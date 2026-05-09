// STOREmind — Klaviyo & Slack Tools
const delay = ms => new Promise(r => setTimeout(r, ms));

export const klaviyoTools = {
  definitions: [
    { name: 'send_cart_recovery_email', description: 'Send personalised cart recovery email with optional discount.',
      input_schema: { type: 'object', properties: {
        customer_email: { type: 'string' }, customer_name: { type: 'string' },
        cart_items: { type: 'array', items: { type: 'string' } },
        discount_code: { type: 'string' }, discount_percent: { type: 'number' },
      }, required: ['customer_email','customer_name','cart_items'] } },
    { name: 'send_bulk_campaign', description: 'Send a targeted campaign to a segment.',
      input_schema: { type: 'object', properties: {
        segment: { type: 'string', enum: ['high_value','at_risk','new_customers','vip','all'] },
        subject: { type: 'string' }, message: { type: 'string' }, include_discount: { type: 'boolean' },
      }, required: ['segment','subject','message'] } },
    { name: 'send_sms', description: 'Send SMS to a customer.',
      input_schema: { type: 'object', properties: { customer_id: { type: 'string' }, message: { type: 'string' } }, required: ['customer_id','message'] } },
  ],
  execute: async (name, input) => {
    await delay(150 + Math.random() * 200);
    const sizes = { high_value: 342, at_risk: 891, new_customers: 1204, vip: 128, all: 8721 };
    switch (name) {
      case 'send_cart_recovery_email': return { success: true, email_id: `email_${Date.now()}`, sent_to: input.customer_email,
        subject: input.discount_code ? `${input.customer_name}, you left something — ${input.discount_percent}% off inside!` : `${input.customer_name}, your cart is waiting`,
        estimated_open_rate: '34%', message: `Recovery email sent to ${input.customer_email}` };
      case 'send_bulk_campaign': return { success: true, campaign_id: `camp_${Date.now()}`,
        segment: input.segment, recipients: sizes[input.segment] ?? 0, estimated_open_rate: '28%',
        message: `Campaign sent to ${sizes[input.segment]} customers` };
      case 'send_sms': return { success: true, sms_id: `sms_${Date.now()}`, delivered: true, message: `SMS sent to ${input.customer_id}` };
      default: return { success: false, error: `Unknown Klaviyo tool: ${name}` };
    }
  },
};

export const slackTools = {
  definitions: [
    { name: 'notify_team', description: 'Send Slack notification to team channel.',
      input_schema: { type: 'object', properties: {
        channel: { type: 'string', enum: ['#alerts','#sales','#operations','#fraud'] },
        message: { type: 'string' },
        urgency: { type: 'string', enum: ['low','medium','high','critical'] },
      }, required: ['channel','message','urgency'] } },
  ],
  execute: async (name, input) => {
    await delay(100);
    return { success: true, channel: input.channel, urgency: input.urgency, message: `Slack sent to ${input.channel}` };
  },
};
