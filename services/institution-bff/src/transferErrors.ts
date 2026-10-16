export interface PublicTransferPreparationError {
  status: number;
  code: string;
}

const CLIENT_ERRORS = new Set([
  'invalid_transfer_request',
  'invalid_transfer_amount',
  'unsupported_transfer_channel',
  'asset_not_available',
  'secure_signer_not_available_for_asset',
  'asset_balance_unavailable',
  'unsupported_token_contract',
  'destination_tag_not_supported',
  'invalid_destination_tag',
  'destination_tag_required',
  'invalid_recipient',
  'self_transfer_not_allowed',
  'own_wallet_destination_invalid',
  'phone_escrow_network_not_supported',
  'phone_escrow_pilot_limit',
  'bitcoin_input_limit_exceeded',
  'solana_source_token_account_unavailable',
  'solana_destination_token_account_invalid',
  'xrpl_trustline_required',
  'xrpl_trustline_frozen',
  'xrpl_destination_activation_minimum',
]);

const BALANCE_ERRORS = new Set([
  'insufficient_balance',
  'insufficient_balance_for_fee',
  'insufficient_balance_for_relay_fee',
]);

const NETWORK_ERRORS = new Set([
  'network_fee_unavailable',
  'bitcoin_network_fee_unavailable',
  'bitcoin_prevout_unavailable',
  'solana_network_fee_unavailable',
  'tron_transaction_build_failed',
  'xrpl_network_fee_unavailable',
  'xrpl_ledger_unavailable',
  'xrpl_reserve_unavailable',
]);

export function publicTransferPreparationError(error: unknown): PublicTransferPreparationError {
  const code = error instanceof Error ? error.message : '';
  if (CLIENT_ERRORS.has(code)) return { status: 400, code };
  if (BALANCE_ERRORS.has(code)) return { status: 422, code };
  if (NETWORK_ERRORS.has(code)) return { status: 503, code };
  return { status: 503, code: 'transfer_preparation_unavailable' };
}
