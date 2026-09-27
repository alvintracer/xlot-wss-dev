import type { WssModuleId } from '@took-wss/contracts';

export interface WssModuleDefinition {
  id: WssModuleId;
  name: string;
  description: string;
  dependsOn: WssModuleId[];
  category: 'core' | 'access' | 'compliance' | 'market' | 'extension';
}

export const WSS_MODULES: Readonly<Record<WssModuleId, WssModuleDefinition>> = {
  'wallet-home': { id: 'wallet-home', name: 'Wallet Home', description: 'Independent wallet-slot selection, selected-wallet balances, and activity summary.', dependsOn: [], category: 'core' },
  'send-receive': { id: 'send-receive', name: 'Send & Receive', description: 'Address and request-based transfer experience.', dependsOn: ['wallet-home'], category: 'core' },
  'sar-recovery': { id: 'sar-recovery', name: 'SAR Recovery', description: 'Customer-controlled 2-of-3 recovery experience.', dependsOn: ['wallet-home'], category: 'core' },
  'super-wallet': { id: 'super-wallet', name: 'Super Wallet', description: 'Connect, import, or migrate an external wallet.', dependsOn: ['wallet-home'], category: 'access' },
  'phone-transfer': { id: 'phone-transfer', name: 'Phone Transfer', description: 'Escrowed transfer to a verified phone recipient.', dependsOn: ['send-receive'], category: 'access' },
  'messaging-transfer': { id: 'messaging-transfer', name: 'Messaging Transfer', description: 'E2E message-linked payment intent.', dependsOn: ['send-receive'], category: 'access' },
  'exchange-connect': { id: 'exchange-connect', name: 'Exchange Connect', description: 'Connect approved exchange deposit and withdrawal flows.', dependsOn: ['wallet-home'], category: 'access' },
  card: { id: 'card', name: 'Wallet Card', description: 'Optional card-linked wallet experience.', dependsOn: ['wallet-home'], category: 'extension' },
  'dapp-browser': { id: 'dapp-browser', name: 'Open Web3', description: 'Isolated external DApp access with a regulated boundary.', dependsOn: ['wallet-home', 'kyt'], category: 'extension' },
  kyt: { id: 'kyt', name: 'TranSight KYT', description: 'Pre-transaction risk screening and decision evidence.', dependsOn: [], category: 'compliance' },
  'travel-rule': { id: 'travel-rule', name: 'Travel Rule', description: 'Institution policy and VASP information flow.', dependsOn: ['send-receive'], category: 'compliance' },
  'k-vwap': { id: 'k-vwap', name: 'K-VWAP', description: 'KRW reference quote with freshness and source evidence.', dependsOn: [], category: 'market' },
  'gas-sponsorship': { id: 'gas-sponsorship', name: 'Fee Abstraction', description: 'Sponsor, quote, or abstract network fees.', dependsOn: ['send-receive'], category: 'core' },
};

export function validateModuleSelection(selected: readonly WssModuleId[]): string[] {
  const enabled = new Set(selected);
  const errors: string[] = [];
  for (const id of selected) {
    for (const dependency of WSS_MODULES[id].dependsOn) {
      if (!enabled.has(dependency)) errors.push(`${id} requires ${dependency}`);
    }
  }
  return errors;
}

export function getEnabledModules(selected: readonly WssModuleId[]): WssModuleDefinition[] {
  const errors = validateModuleSelection(selected);
  if (errors.length > 0) throw new Error(errors.join('; '));
  return selected.map((id) => WSS_MODULES[id]);
}
