// STOREmind — Human Approval Queue
// Write actions (cancel_order, send_cart_recovery_email, apply_discount)
// are queued here and require explicit merchant approval before execution.
// Only get_* read actions bypass the queue.

// Tools that ALWAYS require approval (write actions on live data)
export const REQUIRES_APPROVAL = new Set([
  'cancel_order',           // never auto-execute — too destructive
  'apply_discount',         // requires approval in first 30 days
  'send_cart_recovery_email',
  'send_bulk_campaign',
  'send_sms',
]);

// Tools that run automatically after 30 days of successful approvals
export const AUTO_AFTER_TRUST = new Set([
  'apply_discount',
  'send_cart_recovery_email',
  'send_sms',
]);

// cancel_order is ALWAYS manual — never auto-executes
export const ALWAYS_MANUAL = new Set(['cancel_order']);

export class ApprovalQueue {
  constructor(broadcastFn) {
    this.broadcast   = broadcastFn;
    this.pending     = new Map(); // id → { tool, input, reasoning, resolve, reject }
    this._nextId     = 1;
    this.approvedCount = 0;
    this.rejectedCount = 0;

    // Trust threshold: after this many approvals, AUTO_AFTER_TRUST tools run automatically
    this.TRUST_THRESHOLD = parseInt(process.env.APPROVAL_TRUST_THRESHOLD || '500');
  }

  // Called by agent before executing any write action
  // Returns: { approved: true, result } | { approved: false, reason }
  async request({ tool, input, reasoning, storeId = 'default' }) {
    // Read-only tools bypass queue entirely
    if (!REQUIRES_APPROVAL.has(tool)) {
      return { approved: true, bypass: true };
    }

    // Auto-approve non-destructive tools once trust is established
    const isTrusted = this.approvedCount >= this.TRUST_THRESHOLD;
    if (isTrusted && AUTO_AFTER_TRUST.has(tool) && !ALWAYS_MANUAL.has(tool)) {
      console.log(`[Approval] Auto-approved (trusted): ${tool}`);
      return { approved: true, auto: true };
    }

    // Queue for human decision
    const id = this._nextId++;
    const priority = tool === 'cancel_order' ? 'critical'
                   : (input.value || 0) > 200 ? 'high' : 'normal';

    const item = {
      id, tool, input, reasoning, storeId, priority,
      created_at: Date.now(),
      status: 'pending',
    };

    // Broadcast to dashboard for merchant to see
    this.broadcast({ type: 'approval_required', item, timestamp: Date.now() });
    console.log(`[Approval] Queued: ${tool} (id=${id}, priority=${priority})`);

    // Wait for merchant decision (timeout: 10 min)
    return new Promise((resolve, reject) => {
      this.pending.set(id, { ...item, resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          this.broadcast({ type: 'approval_expired', id, tool, timestamp: Date.now() });
          resolve({ approved: false, reason: 'timeout — no response in 10 minutes' });
        }
      }, 10 * 60 * 1000);
    });
  }

  // Called from WebSocket/REST when merchant clicks Approve/Reject
  decide(id, decision, decidedBy = 'merchant') {
    const item = this.pending.get(id);
    if (!item) return { error: 'Not found or already decided' };

    this.pending.delete(id);
    const approved = decision === 'approve';

    if (approved) this.approvedCount++;
    else this.rejectedCount++;

    this.broadcast({
      type:     'approval_decided',
      id, tool: item.tool,
      approved, decidedBy,
      timestamp: Date.now(),
    });

    item.resolve({ approved, decidedBy });
    console.log(`[Approval] ${approved ? '✅ Approved' : '❌ Rejected'}: ${item.tool} (id=${id})`);

    return {
      approved,
      tool:      item.tool,
      trustLevel: `${this.approvedCount}/${this.TRUST_THRESHOLD}`,
    };
  }

  getPending() {
    return Array.from(this.pending.values()).map(({ resolve, reject, ...rest }) => rest);
  }

  getStats() {
    return {
      pending:       this.pending.size,
      approved:      this.approvedCount,
      rejected:      this.rejectedCount,
      trustLevel:    this.approvedCount,
      trustThreshold: this.TRUST_THRESHOLD,
      fullyTrusted:  this.approvedCount >= this.TRUST_THRESHOLD,
    };
  }
}
