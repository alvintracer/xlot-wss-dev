import { assertTenantManifest, type TenantManifest } from '@took-wss/contracts';
import { validateModuleSelection } from '@took-wss/module-registry';

export const kiwoomManifest = assertTenantManifest({
  schemaVersion: 1,
  tenantId: 'kiwoom',
  slug: 'kiwoom-wallet',
  institutionName: '키움증권',
  walletName: '키움 디지털 월렛',
  environment: 'sandbox',
  deploymentMode: 'dedicated',
  presentation: {
    profileId: 'kiwoom-simple-mode-v1',
    guideVersion: '1.0.0',
    rootHeaderOwner: 'host',
    rootNavigationOwner: 'host',
    safeAreaOwner: 'host',
    navigation: {
      rootEntry: 'host-tabs',
      focusedFlow: 'hide-host-chrome',
      walletMenu: 'none',
    },
  },
  brand: {
    logoText: '키움',
    primaryColor: '#7D3BDD',
    accentColor: '#7D42C3',
    surfaceColor: '#F5F5F5',
    textColor: '#1B1C20',
    radius: 'soft',
  },
  identity: {
    onboardingMode: 'phone-first',
    phoneVerification: 'supabase-auth-solapi',
    consentVersion: 'kiwoom-wallet-profile-v1',
  },
  enabledModules: [
    'wallet-home',
    'send-receive',
    'sar-recovery',
    'super-wallet',
    'phone-transfer',
    'messaging-transfer',
    'exchange-connect',
    'card',
    'dapp-browser',
    'kyt',
    'travel-rule',
    'k-vwap',
    'gas-sponsorship',
  ],
  keyManagement: {
    policyVersion: 1,
    recoveryRequirement: 'sar-preferred',
    defaultAdapter: 'took-sar',
    allowedAdapters: ['took-sar', 'thirdweb-user-wallet', 'fsl-mpc'],
  },
  providers: {
    execution: 'fsl-wis',
    compliance: 'transight',
    quote: 'bonanza-k-vwap',
  },
  chains: ['ethereum', 'polygon', 'arbitrum', 'base', 'bnb', 'solana', 'bitcoin', 'tron', 'xrp'],
  assetPolicy: {
    stablecoins: ['USDC', 'USDT', 'RLUSD', 'PYUSD', 'USDG', 'DAI', 'USDS', 'FDUSD', 'USDP', 'GUSD', 'XUSD', 'EURC', 'JPYC', 'XSGD'],
  },
} satisfies TenantManifest);

const moduleErrors = validateModuleSelection(kiwoomManifest.enabledModules);
if (moduleErrors.length > 0) throw new Error(`Invalid Kiwoom module selection: ${moduleErrors.join(', ')}`);
