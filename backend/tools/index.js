// STOREmind — Tool Registry
import { shopifyTools } from './shopify.js';
import { klaviyoTools, slackTools } from './klaviyo.js';

export function getAllToolDefinitions() {
  return [...shopifyTools.definitions, ...klaviyoTools.definitions, ...slackTools.definitions];
}

const _shopify = new Set(shopifyTools.definitions.map(t => t.name));
const _klaviyo = new Set(klaviyoTools.definitions.map(t => t.name));
const _slack   = new Set(slackTools.definitions.map(t => t.name));

export async function executeTool(name, input) {
  if (_shopify.has(name)) return shopifyTools.execute(name, input);
  if (_klaviyo.has(name)) return klaviyoTools.execute(name, input);
  if (_slack.has(name))   return slackTools.execute(name, input);
  return { success: false, error: `Tool not found: ${name}` };
}
