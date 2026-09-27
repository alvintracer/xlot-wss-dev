import { describe, expect, it } from 'vitest';
import { transitionTransfer } from './index';

describe('institutional transfer state', () => {
  it('allows the policy-first happy path', () => {
    let state = transitionTransfer('draft', 'quoted');
    state = transitionTransfer(state, 'screened');
    state = transitionTransfer(state, 'awaiting-customer-approval');
    state = transitionTransfer(state, 'submitted');
    expect(transitionTransfer(state, 'confirmed')).toBe('confirmed');
  });

  it('does not allow execution before policy screening', () => {
    expect(() => transitionTransfer('quoted', 'submitted')).toThrow('Invalid transfer transition');
  });
});
