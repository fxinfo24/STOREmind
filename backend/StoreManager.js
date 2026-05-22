// STOREmind — Multi-Tenant Store Manager
// Each store gets its own isolated agent instance, config, and approval queue.
// Supports unlimited stores on a single server.
import { STOREmindAgent } from './agent.js';
import { ApprovalQueue }  from './approval/queue.js';

export class StoreManager {
  constructor(broadcastFn) {
    this._broadcast = broadcastFn;
    this._stores    = new Map(); // storeId → { agent, approvalQueue, config, meta }
  }

  // Register or update a store
  register(storeId, config = {}) {
    if (this._stores.has(storeId)) {
      const store = this._stores.get(storeId);
      store.config = { ...store.config, ...config };
      console.log(`[StoreManager] Updated store: ${storeId}`);
      return store;
    }
    const storeBroadcast = (data) => this._broadcast({ ...data, storeId });
    const approvalQueue  = new ApprovalQueue(storeBroadcast);
    const agent          = new STOREmindAgent(storeBroadcast, storeId, approvalQueue, config);

    const store = { storeId, agent, approvalQueue, config, meta: { registeredAt: Date.now() } };
    this._stores.set(storeId, store);
    console.log(`[StoreManager] Registered store: ${storeId} (total: ${this._stores.size})`);
    return store;
  }

  get(storeId)     { return this._stores.get(storeId); }
  getAgent(storeId){ return this._stores.get(storeId)?.agent; }
  getQueue(storeId){ return this._stores.get(storeId)?.approvalQueue; }
  all()            { return Array.from(this._stores.values()); }
  storeIds()       { return Array.from(this._stores.keys()); }

  startAll()  { for (const s of this.all()) s.agent.start(); }
  stopAll()   { for (const s of this.all()) s.agent.stop(); }

  status() {
    return Array.from(this._stores.entries()).map(([id, s]) => ({
      storeId:    id,
      isRunning:  s.agent.isRunning,
      cycleCount: s.agent.cycleCount,
      pendingApprovals: s.approvalQueue.getPending().length,
      state:      s.agent.getStatus().state,
    }));
  }

  remove(storeId) {
    const store = this._stores.get(storeId);
    if (store) { store.agent.stop(); this._stores.delete(storeId); }
  }
}
