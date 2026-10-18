import { assertTenantManifest, type TenantManifest } from '@took-wss/contracts';
import { validateModuleSelection } from '@took-wss/module-registry';
import { kiwoomManifest } from '@took-wss/tenant-kiwoom';

// The Kiwoom sandbox capability set is the common preview baseline. Namu's
// institution policies and provider approvals still require separate validation.
export const namuManifest = assertTenantManifest({
  ...kiwoomManifest,
  tenantId: 'namu',
  slug: 'namu-wallet',
  institutionName: 'NH투자증권',
  walletName: '나무 월렛',
  presentation: {
    ...kiwoomManifest.presentation,
    profileId: 'namu-investment-wallet-v1',
    guideVersion: '1.0.0',
    secureKeypadLayout: 'four-column',
    nativeAuthRedirectUri: 'com.tookwss.namu://auth',
  },
  brand: {
    logoText: '나무',
    paymentCoinLogoUrl: '/icons/namu-wallet-v3-512.png',
    primaryColor: '#84C43D',
    accentColor: '#3A6F24',
    surfaceColor: '#D3E9EA',
    textColor: '#111619',
    radius: 'soft',
  },
  identity: {
    ...kiwoomManifest.identity,
    consentVersion: 'namu-wallet-profile-v1',
  },
} satisfies TenantManifest);

const moduleErrors = validateModuleSelection(namuManifest.enabledModules);
if (moduleErrors.length > 0) throw new Error(`Invalid Namu module selection: ${moduleErrors.join(', ')}`);
