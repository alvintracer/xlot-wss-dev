import { describe, expect, it } from 'vitest';
import { KEY_POLICY_PRESETS } from './index';

describe('key recovery policy presets', () => {
  it('makes SAR the default without removing provider options from the recommended preset', () => {
    expect(KEY_POLICY_PRESETS['sar-preferred']).toMatchObject({
      defaultAdapter: 'took-sar',
      allowedAdapters: ['took-sar', 'thirdweb-user-wallet', 'fsl-mpc'],
      sarRecoveryEnabled: true,
    });
  });

  it('provides a project preset that omits SAR completely', () => {
    expect(KEY_POLICY_PRESETS['provider-recovery-accepted']).toMatchObject({
      defaultAdapter: 'thirdweb-user-wallet',
      allowedAdapters: ['thirdweb-user-wallet', 'fsl-mpc'],
      sarRecoveryEnabled: false,
    });
  });
});
