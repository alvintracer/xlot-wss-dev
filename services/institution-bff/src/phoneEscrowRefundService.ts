import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import postgres from 'postgres';
import type { PreparedTransfer, SecureTransactionSigningRequest, SubmitTransferRequest, TransferExecutionResult, WssSessionClaims } from '@took-wss/contracts';
import { nativeAssetConfig, nativeAssetRpcUrl } from './assetPortfolio.js';

type Session = Omit<WssSessionClaims, 'nonce'>;
const sql = process.env.DATABASE_URL?.trim() && !process.env.VITEST
  ? postgres(process.env.DATABASE_URL.trim(), { max: 3, prepare: false, idle_timeout: 20 }) : null;
const escrowInterface = new ethers.Interface([
  'function deposits(bytes32) view returns (address sender,address token,uint256 amount,uint64 expiry,bool isClaimed)',
  'function refund(bytes32 commitment)',
  'event Refunded(bytes32 indexed commitment,address indexed sender)',
]);

interface RefundRow {
  id: string;
  tenant_id: string;
  transfer_intent_id: string;
  wallet_id: string;
  chain_id: string;
  evm_chain_id: number;
  escrow_contract_address: string;
  token_contract_address: string;
  commitment: string;
  escrow_amount_atomic: string;
  expires_at: Date;
  status: string;
  refund_intent_id: string | null;
  refund_signing_request: SecureTransactionSigningRequest | null;
  refund_expires_at: Date | null;
  refund_transaction_hash: string | null;
  from_address: string;
  prepared_payload: PreparedTransfer | null;
}

function database() {
  if (!sql) throw new Error('refund_store_unavailable');
  return sql;
}

async function rowFor(session: Session, field: 'transfer' | 'refund', value: string): Promise<RefundRow> {
  const db = database();
  const rows = await db<RefundRow[]>`
    SELECT escrow.id, escrow.tenant_id, escrow.transfer_intent_id, escrow.wallet_id,
      escrow.chain_id, escrow.evm_chain_id, escrow.escrow_contract_address,
      escrow.token_contract_address, escrow.commitment, escrow.escrow_amount_atomic,
      escrow.expires_at, escrow.status, escrow.refund_intent_id,
      escrow.refund_signing_request, escrow.refund_expires_at,
      escrow.refund_transaction_hash, intent.from_address, intent.prepared_payload
    FROM wss_phone_escrows escrow
    JOIN wss_transfer_intents intent ON intent.tenant_id = escrow.tenant_id
      AND intent.id = escrow.transfer_intent_id
    WHERE escrow.tenant_id = ${session.tenantId} AND escrow.subject_hash = ${session.subject}
      AND ${field === 'transfer' ? db`escrow.transfer_intent_id = ${value}` : db`escrow.refund_intent_id = ${value}`}
    LIMIT 1
  `;
  if (!rows[0]) throw new Error('phone_escrow_not_found');
  return rows[0];
}

async function contractDeposit(row: RefundRow, provider: ethers.JsonRpcProvider) {
  const response = await provider.call({
    to: row.escrow_contract_address,
    data: escrowInterface.encodeFunctionData('deposits', [row.commitment]),
  });
  const deposit = escrowInterface.decodeFunctionResult('deposits', response);
  return {
    sender: ethers.getAddress(String(deposit.sender)),
    token: ethers.getAddress(String(deposit.token)),
    amount: BigInt(deposit.amount),
    expiry: BigInt(deposit.expiry),
    claimed: Boolean(deposit.isClaimed),
  };
}

export async function preparePhoneRefund(input: { session: Session; transferIntentId: string }): Promise<SecureTransactionSigningRequest> {
  const row = await rowFor(input.session, 'transfer', input.transferIntentId);
  if (row.refund_signing_request && row.refund_expires_at && row.refund_expires_at.getTime() > Date.now()
    && row.status !== 'refunding' && row.status !== 'refunded') return row.refund_signing_request;
  if (!['funded', 'notified', 'expired'].includes(row.status) || row.expires_at.getTime() > Date.now()) {
    throw new Error('phone_refund_not_available');
  }
  const rpc = nativeAssetRpcUrl(row.chain_id);
  const config = nativeAssetConfig(row.chain_id);
  if (!rpc || config?.evmChainId !== row.evm_chain_id) throw new Error('refund_provider_unavailable');
  const provider = new ethers.JsonRpcProvider(rpc, row.evm_chain_id, { staticNetwork: true });
  const deposit = await contractDeposit(row, provider);
  if (deposit.sender.toLowerCase() !== row.from_address.toLowerCase()
    || deposit.token.toLowerCase() !== row.token_contract_address.toLowerCase()
    || deposit.amount !== BigInt(row.escrow_amount_atomic)
    || deposit.expiry !== BigInt(Math.floor(row.expires_at.getTime() / 1000))
    || deposit.claimed) throw new Error('phone_refund_deposit_mismatch');
  const latest = await provider.getBlock('latest');
  if (!latest || BigInt(latest.timestamp) <= deposit.expiry) throw new Error('phone_refund_not_available');
  const data = escrowInterface.encodeFunctionData('refund', [row.commitment]);
  const [nonce, fee, gasLimit, balance] = await Promise.all([
    provider.getTransactionCount(row.from_address, 'pending'),
    provider.getFeeData(),
    provider.estimateGas({ from: row.from_address, to: row.escrow_contract_address, value: 0n, data }),
    provider.getBalance(row.from_address),
  ]);
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas;
  if (!gasPrice) throw new Error('network_fee_unavailable');
  const limit = gasLimit * 12n / 10n;
  if (balance < limit * gasPrice) throw new Error('insufficient_balance_for_fee');
  const refundIntentId = randomUUID();
  const signingRequest: SecureTransactionSigningRequest = {
    intentId: refundIntentId, walletId: row.wallet_id, operation: 'refund',
    chainId: row.chain_id, network: row.prepared_payload?.network ?? row.chain_id,
    assetSymbol: row.prepared_payload?.assetSymbol ?? '자산',
    amountDisplay: row.prepared_payload?.phoneEscrow?.escrowAmountDisplay ?? row.escrow_amount_atomic,
    fromAddress: row.from_address, recipient: row.from_address, channel: 'phone',
    transaction: {
      type: 'evm-native', purpose: 'phone-escrow-refund', chainId: row.evm_chain_id,
      nonce, to: row.escrow_contract_address, value: '0', gasLimit: limit.toString(),
      gasPrice: gasPrice.toString(), data,
    },
  };
  const updated = await database()`
    UPDATE wss_phone_escrows SET refund_intent_id = ${refundIntentId},
      refund_signing_request = ${database().json(JSON.parse(JSON.stringify(signingRequest)))},
      refund_expires_at = ${new Date(Date.now() + 2 * 60_000).toISOString()}, updated_at = now()
    WHERE id = ${row.id} AND status IN ('funded', 'notified', 'expired')
    RETURNING id
  `;
  if (!updated.length) throw new Error('phone_refund_not_available');
  return signingRequest;
}

export async function getPhoneRefundSigningRequest(input: { session: Session; refundIntentId: string }): Promise<SecureTransactionSigningRequest> {
  const row = await rowFor(input.session, 'refund', input.refundIntentId);
  if (!row.refund_signing_request || !row.refund_expires_at || row.refund_expires_at.getTime() <= Date.now()
    || row.status === 'refunding' || row.status === 'refunded') throw new Error('phone_refund_not_available');
  return row.refund_signing_request;
}

export async function getPhoneRefundStatus(input: { session: Session; transferIntentId: string }): Promise<{ status: string; transactionHash?: string }> {
  const row = await rowFor(input.session, 'transfer', input.transferIntentId);
  if (row.status !== 'refunding' || !row.refund_transaction_hash) return {
    status: row.status,
    ...(row.refund_transaction_hash ? { transactionHash: row.refund_transaction_hash } : {}),
  };
  const rpc = nativeAssetRpcUrl(row.chain_id);
  if (!rpc) return { status: 'refunding', transactionHash: row.refund_transaction_hash };
  const provider = new ethers.JsonRpcProvider(rpc, row.evm_chain_id, { staticNetwork: true });
  const receipt = await provider.getTransactionReceipt(row.refund_transaction_hash);
  if (!receipt) return { status: 'refunding', transactionHash: row.refund_transaction_hash };
  if (receipt.status === 0) {
    await database()`
      UPDATE wss_phone_escrows SET status = 'expired', refund_transaction_hash = NULL, updated_at = now()
      WHERE id = ${row.id} AND status = 'refunding'
    `;
    return { status: 'expired' };
  }
  const matched = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== row.escrow_contract_address.toLowerCase()) return false;
    try {
      const event = escrowInterface.parseLog(log);
      return event?.name === 'Refunded'
        && String(event.args.commitment).toLowerCase() === row.commitment.toLowerCase()
        && String(event.args.sender).toLowerCase() === row.from_address.toLowerCase();
    } catch { return false; }
  });
  if (!matched) return { status: 'refunding', transactionHash: row.refund_transaction_hash };
  await database()`
    UPDATE wss_phone_escrows SET status = 'refunded', updated_at = now()
    WHERE id = ${row.id} AND status = 'refunding'
  `;
  return { status: 'refunded', transactionHash: row.refund_transaction_hash };
}

export async function submitPhoneRefund(input: {
  session: Session; request: SubmitTransferRequest; authorizationId: string;
}): Promise<TransferExecutionResult> {
  const row = await rowFor(input.session, 'refund', input.request.intentId);
  if (row.status === 'refunding' || row.status === 'refunded') {
    const status = await getPhoneRefundStatus({ session: input.session, transferIntentId: row.transfer_intent_id });
    return { intentId: input.request.intentId, status: status.status === 'refunded' ? 'confirmed' : 'processing',
      ...(status.transactionHash ? { transactionHash: status.transactionHash } : {}) };
  }
  const signing = await getPhoneRefundSigningRequest({ session: input.session, refundIntentId: input.request.intentId });
  const expected = signing.transaction;
  if (expected.type !== 'evm-native' || expected.purpose !== 'phone-escrow-refund') throw new Error('phone_refund_intent_mismatch');
  const signed = ethers.Transaction.from(input.request.signedTransaction);
  if (!signed.from || signed.from.toLowerCase() !== signing.fromAddress.toLowerCase()
    || signed.to?.toLowerCase() !== expected.to.toLowerCase()
    || signed.chainId !== BigInt(expected.chainId)
    || signed.nonce !== expected.nonce
    || signed.value !== 0n
    || signed.gasLimit !== BigInt(expected.gasLimit)
    || signed.gasPrice !== BigInt(expected.gasPrice)
    || signed.data.toLowerCase() !== expected.data?.toLowerCase()) throw new Error('signed_transaction_mismatch');
  const transactionHash = ethers.keccak256(input.request.signedTransaction);
  const claimed = await database()`
    UPDATE wss_phone_escrows SET status = 'refunding', refund_transaction_hash = ${transactionHash.toLowerCase()},
      refund_started_at = now(), updated_at = now()
    WHERE id = ${row.id} AND status IN ('funded', 'notified', 'expired')
      AND refund_intent_id = ${input.request.intentId}
    RETURNING id
  `;
  if (!claimed.length) throw new Error('phone_refund_already_processing');
  const rpc = nativeAssetRpcUrl(row.chain_id);
  if (!rpc) throw new Error('refund_provider_unavailable');
  try {
    const provider = new ethers.JsonRpcProvider(rpc, row.evm_chain_id, { staticNetwork: true });
    const broadcast = await provider.broadcastTransaction(input.request.signedTransaction);
    if (broadcast.hash.toLowerCase() !== transactionHash.toLowerCase()) throw new Error('broadcast_transaction_hash_mismatch');
  } catch {
    // The broadcast may have reached the network. Preserve the hash for reconciliation.
  }
  return { intentId: input.request.intentId, status: 'processing', transactionHash };
}
