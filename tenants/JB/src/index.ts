import { assertTenantManifest, type TenantManifest } from '@took-wss/contracts';
import { validateModuleSelection } from '@took-wss/module-registry';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';

export const jbManifest = assertTenantManifest({
  ...kiwoomManifest,
  tenantId: 'jb',
  slug: 'jb-wallet',
  institutionName: '전북은행',
  walletName: 'JB 월렛',
  presentation: {
    ...kiwoomManifest.presentation,
    profileId: 'jb-mobile-wallet-v1',
    guideVersion: '1.0.0',
    secureKeypadLayout: 'three-column',
  },
  brand: {
    logoText: 'JB',
    paymentCoinLogoUrl: '/icons/jb-wallet-v3-512.png',
    primaryColor: '#0874E8',
    accentColor: '#0874E8',
    surfaceColor: '#F0F3F8',
    textColor: '#202428',
    radius: 'soft',
  },
  identity: {
    ...kiwoomManifest.identity,
    consentVersion: 'jb-wallet-profile-v1',
  },
} satisfies TenantManifest);

const moduleErrors = validateModuleSelection(jbManifest.enabledModules);
if (moduleErrors.length > 0) throw new Error(`Invalid JB module selection: ${moduleErrors.join(', ')}`);
