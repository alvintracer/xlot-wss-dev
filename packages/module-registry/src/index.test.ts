import { describe, expect, it } from 'vitest';
import { validateModuleSelection } from './index';

describe('WSS module selection', () => {
  it('accepts a complete wallet transfer slice', () => {
    expect(validateModuleSelection(['wallet-home', 'send-receive', 'kyt', 'gas-sponsorship'])).toEqual([]);
  });

  it('rejects a dependent module without its prerequisite', () => {
    expect(validateModuleSelection(['wallet-home', 'phone-transfer'])).toContain('phone-transfer requires send-receive');
  });
});
