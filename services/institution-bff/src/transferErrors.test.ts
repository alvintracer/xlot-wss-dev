import { describe, expect, it } from 'vitest';
import { publicTransferPreparationError } from './transferErrors';

describe('public transfer preparation errors', () => {
  it('preserves actionable balance and fee failures', () => {
    expect(publicTransferPreparationError(new Error('insufficient_balance')))
      .toEqual({ status: 422, code: 'insufficient_balance' });
    expect(publicTransferPreparationError(new Error('insufficient_balance_for_fee')))
      .toEqual({ status: 422, code: 'insufficient_balance_for_fee' });
  });

  it('maps provider details to a stable public failure', () => {
    expect(publicTransferPreparationError(new Error('could not coalesce error')))
      .toEqual({ status: 503, code: 'transfer_preparation_unavailable' });
  });
});
