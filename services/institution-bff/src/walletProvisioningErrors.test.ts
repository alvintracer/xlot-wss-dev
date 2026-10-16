import { describe, expect, it } from 'vitest';
import { publicWalletProvisioningError } from './walletProvisioningErrors.js';

describe('publicWalletProvisioningError', () => {
  it('identifies an existing address without exposing database values', () => {
    expect(publicWalletProvisioningError(new Error('wallet_address_already_registered'))).toEqual({
      status: 409,
      code: 'wallet_address_already_registered',
    });
    expect(publicWalletProvisioningError({
      code: '23505',
      constraint_name: 'wss_wallet_accounts_tenant_id_chain_id_address_normalized_key',
      detail: 'Key (address_normalized)=(sensitive-address) already exists.',
    })).toEqual({ status: 409, code: 'wallet_address_already_registered' });
  });

  it('returns a distinct conflict for an MPC account already linked to this tenant', () => {
    expect(publicWalletProvisioningError(new Error('provider_wallet_already_registered'))).toEqual({
      status: 409,
      code: 'provider_wallet_already_registered',
    });
  });

  it('separates expired proofs from a changed session', () => {
    expect(publicWalletProvisioningError(new Error('wallet_authorization_expired'))).toEqual({
      status: 401,
      code: 'wallet_authorization_expired',
    });
    expect(publicWalletProvisioningError(new Error('wallet_import_proof_expired'))).toEqual({
      status: 409,
      code: 'wallet_import_proof_expired',
    });
    expect(publicWalletProvisioningError(new Error('Host proof session mismatch.'))).toEqual({
      status: 401,
      code: 'wallet_session_changed',
    });
  });

  it('does not forward unknown internal errors', () => {
    expect(publicWalletProvisioningError(new Error('private database detail'))).toEqual({
      status: 400,
      code: 'request_rejected',
    });
  });
});
