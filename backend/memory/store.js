// STOREmind — Agent Memory & State

export class AgentMemory {
  constructor() {
    this.state = {
      storesAnalyzed: 12542, customerInteractions: 8721,
      actionsTaken: 3248, successRate: 96.7,
      recentActions: [], currentThinking: '', agentStatus: 'active',
      metrics: { ordersProcessed: 1248, revenueInfluenced: 47892, cartsRecovered: 312, timeSaved: 128 },
    };
    this.shortTermMemory = [];
    this.longTermMemory = { successfulActions: [], failedActions: [], fraudPatterns: [] };
  }

  remember(entry) {
    this.shortTermMemory.push({ ...entry, timestamp: new Date().toISOString() });
    if (this.shortTermMemory.length > 20) this.shortTermMemory.shift();
  }

  recordAction(action) {
    const entry = { id: Date.now(), ...action, timestamp: new Date().toISOString() };
    this.state.recentActions.unshift(entry);
    if (this.state.recentActions.length > 50) this.state.recentActions.pop();
    this.state.actionsTaken++;
    this.state.customerInteractions++;
    this.remember({ type: 'action', ...entry });
    action.success ? this.longTermMemory.successfulActions.push(entry)
                   : this.longTermMemory.failedActions.push(entry);
    this._updateSuccessRate();
    return entry;
  }

  _updateSuccessRate() {
    const total = this.longTermMemory.successfulActions.length + this.longTermMemory.failedActions.length;
    if (!total) return;
    this.state.successRate = Math.round((this.longTermMemory.successfulActions.length / total) * 1000) / 10;
  }

  getContext() {
    return {
      recentActions: this.shortTermMemory.slice(-5),
      patterns: { topSuccessfulActions: this.longTermMemory.successfulActions.slice(-3), knownFraudPatterns: this.longTermMemory.fraudPatterns.slice(-5) },
      currentMetrics: this.state.metrics,
    };
  }

  updateMetrics(updates) { this.state.metrics = { ...this.state.metrics, ...updates }; }
  getState() { return this.state; }
}
