import { assertTenantManifest, type TenantManifest } from '@took-wss/contracts';
import { validateModuleSelection } from '@took-wss/module-registry';

export const referenceBankManifest = assertTenantManifest({
  schemaVersion: 1,
  tenantId: 'reference-bank',
  slug: 'reference-bank-wallet',
  institutionName: 'Reference Bank',
  walletName: 'Reference Wallet',
  environment: 'development',
  deploymentMode: 'saas',
  presentation: {
    profileId: 'wss-reference-bank-v1',
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
    logoText: 'RB',
    primaryColor: '#0B3B8C',
    accentColor: '#16A085',
    surfaceColor: '#F4F7FB',
    textColor: '#101828',
    radius: 'soft',
  },
  identity: {
    onboardingMode: 'institution-first',
    phoneVerification: 'host',
    consentVersion: 'reference-bank-wallet-profile-v1',
  },
  enabledModules: ['wallet-home', 'send-receive', 'sar-recovery', 'phone-transfer', 'kyt', 'k-vwap', 'gas-sponsorship'],
  keyManagement: {
    policyVersion: 1,
    recoveryRequirement: 'sar-preferred',
    defaultAdapter: 'took-sar',
    allowedAdapters: ['took-sar', 'thirdweb-user-wallet', 'fsl-mpc'],
  },
  providers: {
    execution: 'took-router',
    compliance: 'mock',
    quote: 'mock',
  },
  chains: ['ethereum', 'base', 'polygon', 'solana'],
  assetPolicy: {
    stablecoins: ['USDC', 'USDT', 'RLUSD', 'PYUSD', 'XUSD', 'EURC', 'XSGD'],
  },
} satisfies TenantManifest);

const moduleErrors = validateModuleSelection(referenceBankManifest.enabledModules);
if (moduleErrors.length > 0) throw new Error(`Invalid reference tenant module selection: ${moduleErrors.join(', ')}`);
