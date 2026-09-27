import type { KeyAdapterId, RecoveryRequirement } from '@took-wss/contracts';

export interface KeyAdapterDescriptor {
  id: KeyAdapterId;
  label: string;
  custody: 'customer-controlled';
  recovery: 'sar-2-of-3' | 'provider-policy';
  signsIn: 'customer-device' | 'approved-provider-client';
  serverReceivesKeyMaterial: false;
}

export const KEY_ADAPTERS: Readonly<Record<KeyAdapterId, KeyAdapterDescriptor>> = {
  'took-sar': {
    id: 'took-sar',
    label: 'took SAR 2-of-3',
    custody: 'customer-controlled',
    recovery: 'sar-2-of-3',
    signsIn: 'customer-device',
    serverReceivesKeyMaterial: false,
  },
  'thirdweb-user-wallet': {
    id: 'thirdweb-user-wallet',
    label: 'Thirdweb User Wallet',
    custody: 'customer-controlled',
    recovery: 'provider-policy',
    signsIn: 'approved-provider-client',
    serverReceivesKeyMaterial: false,
  },
  'fsl-mpc': {
    id: 'fsl-mpc',
    label: 'FSL MPC',
    custody: 'customer-controlled',
    recovery: 'provider-policy',
    signsIn: 'approved-provider-client',
    serverReceivesKeyMaterial: false,
  },
};

export function getKeyAdapterDescriptor(id: KeyAdapterId): KeyAdapterDescriptor {
  return KEY_ADAPTERS[id];
}

export interface KeyPolicyPreset {
  id: RecoveryRequirement;
  label: string;
  description: string;
  defaultAdapter: KeyAdapterId;
  allowedAdapters: KeyAdapterId[];
  sarRecoveryEnabled: boolean;
}

export const KEY_POLICY_PRESETS: Readonly<Record<RecoveryRequirement, KeyPolicyPreset>> = {
  'sar-required': {
    id: 'sar-required',
    label: 'SAR 필수',
    description: '모든 신규 지갑을 완전 자가복구형 SAR로 생성합니다.',
    defaultAdapter: 'took-sar',
    allowedAdapters: ['took-sar'],
    sarRecoveryEnabled: true,
  },
  'sar-preferred': {
    id: 'sar-preferred',
    label: 'SAR 권장',
    description: 'SAR를 기본으로 사용하고 승인된 Provider 방식을 함께 허용합니다.',
    defaultAdapter: 'took-sar',
    allowedAdapters: ['took-sar', 'thirdweb-user-wallet', 'fsl-mpc'],
    sarRecoveryEnabled: true,
  },
  'provider-recovery-accepted': {
    id: 'provider-recovery-accepted',
    label: 'Provider 복구 허용',
    description: '기관이 승인한 Provider 복구 정책으로 지갑을 구성합니다.',
    defaultAdapter: 'thirdweb-user-wallet',
    allowedAdapters: ['thirdweb-user-wallet', 'fsl-mpc'],
    sarRecoveryEnabled: false,
  },
};
