import { assertTenantManifest, type TenantManifest } from '@took-wss/contracts';
import { validateModuleSelection } from '@took-wss/module-registry';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';

// Common WSS capabilities for a development preview. Institution policies,
// providers, consent, and native secure input require separate approval.
export const shinhanManifest = assertTenantManifest({
  ...kiwoomManifest,
  tenantId: 'shinhan',
  slug: 'shinhan-super-sol-wallet',
  institutionName: '신한은행',
  walletName: '쏠지갑',
  presentation: {
    ...kiwoomManifest.presentation,
    profileId: 'shinhan-super-sol-preview-v1',
    guideVersion: '1.0.0',
    secureKeypadLayout: 'three-column',
    previewKeypadKeys: ['1', '0', '4', '3', '2', '8', '9', '6', '7', 'clear', '5', 'delete'],
    nativeAuthRedirectUri: 'com.tookwss.shinhan://auth',
  },
  brand: {
    logoText: 'SOL',
    paymentCoinLogoUrl: '/icons/shinhan-super-sol-512.png',
    primaryColor: '#0565F5',
    accentColor: '#0649F6',
    surfaceColor: '#F0F3FA',
    textColor: '#172132',
    radius: 'soft',
  },
  identity: {
    ...kiwoomManifest.identity,
    consentVersion: 'shinhan-wallet-preview-v1',
  },
} satisfies TenantManifest);

const moduleErrors = validateModuleSelection(shinhanManifest.enabledModules);
if (moduleErrors.length) throw new Error(`Invalid Shinhan module selection: ${moduleErrors.join(', ')}`);
