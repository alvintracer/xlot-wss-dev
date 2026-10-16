export interface PublicWalletProvisioningError {
  status: number;
  code: string;
}

export function publicWalletProvisioningError(error: unknown): PublicWalletProvisioningError {
  const message = error instanceof Error ? error.message : '';
  if (message === 'wallet_address_already_registered') {
    return { status: 409, code: message };
  }
  if (message === 'provider_wallet_already_registered') {
    return { status: 409, code: message };
  }
  if (message === 'wallet_authorization_expired') {
    return { status: 401, code: message };
  }
  if (message === 'wallet_import_proof_expired') {
    return { status: 409, code: message };
  }
  if (message === 'thirdweb_not_configured' || message === 'thirdweb_persistent_provider_required') {
    return { status: 503, code: message };
  }
  if (message === 'thirdweb_auth_failed' || message === 'thirdweb_identity_mismatch'
    || message === 'provider_proof_invalid'
    || message === 'provider_auth_required') {
    return { status: 401, code: message };
  }
  if (message === 'provider_wallet_link_conflict' || message === 'provider_wallet_not_found') {
    return { status: 409, code: message };
  }
  if (message === 'Host proof session mismatch.') {
    return { status: 401, code: 'wallet_session_changed' };
  }
  const databaseError = error as { code?: unknown; constraint_name?: unknown } | null;
  if (databaseError?.code === '23505'
    && databaseError.constraint_name === 'wss_wallet_accounts_tenant_id_chain_id_address_normalized_key') {
    return { status: 409, code: 'wallet_address_already_registered' };
  }
  return { status: 400, code: 'request_rejected' };
}
