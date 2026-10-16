import { randomUUID } from 'node:crypto';
import { ethers } from 'ethers';
import postgres from 'postgres';
import type { PrepareTransferRequest, ReadyWalletHomePayload, WalletPaymentRequest, WssSessionClaims } from '@took-wss/contracts';
import { nativeAssetConfig, nativeAssetRpcUrl } from './assetPortfolio.js';
import { readTookRelayStatus } from './tookPermitRelay.js';

type Session = Omit<WssSessionClaims, 'nonce'>;
const databaseUrl = process.env.DATABASE_URL?.trim();
const sql = databaseUrl && !process.env.VITEST ? postgres(databaseUrl, { max: 3, prepare: false, idle_timeout: 20 }) : null;
const evmChains = new Set(['ethereum', 'polygon', 'arbitrum', 'base', 'bnb']);
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PaymentRow {
  id: string; tenant_id: string; subject_hash: string; wallet_id: string; chain_id: string;
  asset_id: string; asset_symbol: string; decimals: number; amount_atomic: string;
  recipient_address: string; status: string; transfer_intent_id: string | null;
  transaction_hash: string | null; created_at: Date; expires_at: Date;
  reference_price_krw: string | null; reference_price_as_of: Date | null;
  reference_amount_krw: string | null;
  confirmed_at: Date | null;
}

export function krwReferenceAmount(amountAtomic: string, decimals: number, priceDecimal: string): string {
  const [whole, fraction = ''] = priceDecimal.split('.');
  const priceUnits = BigInt(`${whole}${fraction}`);
  const scale = 10n ** BigInt(decimals + fraction.length);
  return ((BigInt(amountAtomic) * priceUnits + scale / 2n) / scale).toString();
}

function database() {
  if (!sql) throw new Error('payment_store_unavailable');
  return sql;
}

function view(row: PaymentRow): WalletPaymentRequest {
  const status = row.status === 'confirmed' || row.status === 'failed' ? row.status
    : row.expires_at.getTime() <= Date.now() && row.status === 'pending' ? 'expired'
      : row.status === 'pending' ? 'pending' : 'processing';
  return {
    id: row.id, tenantId: row.tenant_id, walletId: row.wallet_id,
    chainId: row.chain_id, assetId: row.asset_id, assetSymbol: row.asset_symbol,
    decimals: row.decimals, amountAtomic: row.amount_atomic,
    recipientAddress: row.recipient_address, status,
    ...(status === 'processing' ? { processingStage: row.status === 'reserved' ? 'approval' as const : 'network' as const } : {}),
    expiresAt: row.expires_at.toISOString(), createdAt: row.created_at.toISOString(),
    ...(row.transaction_hash ? { transactionHash: row.transaction_hash } : {}),
    ...(row.reference_price_krw && row.reference_price_as_of && row.reference_amount_krw
      ? { referencePriceKrw: row.reference_price_krw,
          referencePriceAsOf: row.reference_price_as_of.toISOString(),
          referenceAmountKrw: row.reference_amount_krw } : {}),
    ...(row.confirmed_at ? { confirmedAt: row.confirmed_at.toISOString() } : {}),
  };
}

export async function createQrPaymentRequest(input: {
  session: Session; home: ReadyWalletHomePayload;
  chainId: string; assetId: string; amountAtomic: string;
}): Promise<WalletPaymentRequest> {
  if (!evmChains.has(input.chainId) || !/^[1-9]\d{0,38}$/.test(input.amountAtomic)) throw new Error('invalid_payment_request');
  const asset = input.home.receiveAssets.find((item) => item.assetId === input.assetId && item.chainId === input.chainId);
  const network = input.home.networks.find((item) => item.chainId === input.chainId && item.addressStatus === 'ready');
  if (!asset || asset.transferStatus !== 'enabled' || !network?.address || !ethers.isAddress(network.address)) {
    throw new Error('payment_asset_unavailable');
  }
  const reference = asset.referencePrice;
  const price = reference && !reference.stale && /^\d+(?:\.\d+)?$/.test(reference.decimal)
    && Number.isFinite(Date.parse(reference.asOf)) ? reference : null;
  const referenceAmountKrw = price ? krwReferenceAmount(input.amountAtomic, asset.decimals, price.decimal) : null;
  const db = database();
  const rows = await db<PaymentRow[]>`
    INSERT INTO wss_qr_payment_requests
      (id, tenant_id, subject_hash, wallet_id, chain_id, asset_id, asset_symbol, decimals,
       amount_atomic, recipient_address, expires_at,
       reference_price_krw, reference_price_as_of, reference_amount_krw)
    VALUES (${randomUUID()}, ${input.session.tenantId}, ${input.session.subject}, ${input.home.wallet.walletId},
      ${input.chainId}, ${input.assetId}, ${asset.symbol}, ${asset.decimals}, ${input.amountAtomic},
      ${network.address}, now() + interval '15 minutes',
      ${price?.decimal ?? null}, ${price?.asOf ?? null}, ${referenceAmountKrw})
    RETURNING *
  `;
  return view(rows[0]!);
}

async function paymentRow(id: string): Promise<PaymentRow> {
  if (!idPattern.test(id)) throw new Error('payment_request_not_found');
  const rows = await database()<PaymentRow[]>`
    SELECT * FROM wss_qr_payment_requests WHERE id = ${id} LIMIT 1
  `;
  if (!rows[0]) throw new Error('payment_request_not_found');
  return rows[0];
}

async function reconcile(row: PaymentRow): Promise<PaymentRow> {
  if (!row.transfer_intent_id || row.status === 'confirmed' || row.status === 'failed') return row;
  const db = database();
  if (row.status === 'reserved') {
    const released = await db<PaymentRow[]>`
      UPDATE wss_qr_payment_requests SET status = 'pending', transfer_intent_id = NULL,
        payer_tenant_id = NULL, payer_subject_hash = NULL, reserved_until = NULL, updated_at = now()
      WHERE id = ${row.id} AND status = 'reserved' AND reserved_until <= now()
        AND NOT EXISTS (SELECT 1 FROM wss_transfer_executions WHERE transfer_intent_id = ${row.transfer_intent_id})
      RETURNING *
    `;
    if (released[0]) return released[0];
  }
  const executions = await db<{ status: string; transaction_hash: string | null }[]>`
    SELECT execution.status, execution.transaction_hash
    FROM wss_transfer_intents intent
    LEFT JOIN wss_transfer_executions execution ON execution.transfer_intent_id = intent.id
    WHERE intent.id = ${row.transfer_intent_id} AND intent.tenant_id = (
      SELECT payer_tenant_id FROM wss_qr_payment_requests WHERE id = ${row.id})
    LIMIT 1
  `;
  let transactionHash = executions[0]?.transaction_hash ?? row.transaction_hash;
  if (!transactionHash && row.status !== 'submitted') return row;
  let status: 'submitted' | 'confirmed' | 'failed' = 'submitted';
  if (executions[0]?.status === 'confirmed') status = 'confirmed';
  else if (executions[0]?.status === 'failed') status = 'failed';
  else if (!transactionHash && row.chain_id !== 'bnb') {
    const relay = await readTookRelayStatus(`tr_${row.transfer_intent_id}`);
    transactionHash = relay?.txHash ?? transactionHash;
    if (relay?.status === 'confirmed') status = 'confirmed';
    else if (relay?.status === 'failed') status = 'failed';
  }
  if (status === 'submitted' && transactionHash) {
    const config = nativeAssetConfig(row.chain_id);
    const rpc = nativeAssetRpcUrl(row.chain_id);
    if (config?.evmChainId && rpc) {
      try {
        const receipt = await new ethers.JsonRpcProvider(rpc, config.evmChainId, { staticNetwork: true })
          .getTransactionReceipt(transactionHash);
        if (receipt) status = receipt.status === 1 ? 'confirmed' : 'failed';
      } catch { /* Keep submitted until the RPC is available again. */ }
    }
  }
  if (status === 'submitted') return { ...row, transaction_hash: transactionHash };
  const updated = await db<PaymentRow[]>`
    UPDATE wss_qr_payment_requests SET status = ${status}, transaction_hash = ${transactionHash},
      confirmed_at = CASE WHEN ${status} = 'confirmed' THEN now() ELSE confirmed_at END,
      updated_at = now()
    WHERE id = ${row.id} AND status NOT IN ('confirmed','failed') RETURNING *
  `;
  return updated[0] ?? paymentRow(row.id);
}

export async function getQrPaymentRequest(id: string): Promise<WalletPaymentRequest> {
  return view(await reconcile(await paymentRow(id)));
}

export async function listQrPaymentRequests(input: { session: Session; walletId: string }): Promise<WalletPaymentRequest[]> {
  const rows = await database()<PaymentRow[]>`
    SELECT * FROM wss_qr_payment_requests
    WHERE tenant_id = ${input.session.tenantId} AND subject_hash = ${input.session.subject}
      AND wallet_id = ${input.walletId}
    ORDER BY created_at DESC LIMIT 60
  `;
  return Promise.all(rows.map(async (row) => {
    try { return view(await reconcile(row)); }
    catch (error) {
      console.warn('wss_qr_reconcile_failed', { paymentRequestId: row.id,
        code: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : error instanceof Error ? error.name : 'unknown' });
      return view(row);
    }
  }));
}

export async function listSpentQrPayments(input: { session: Session; walletId: string }): Promise<WalletPaymentRequest[]> {
  const rows = await database()<PaymentRow[]>`
    SELECT payment.* FROM wss_qr_payment_requests payment
    JOIN wss_transfer_intents intent ON intent.id = payment.transfer_intent_id
    WHERE payment.payer_tenant_id = ${input.session.tenantId}
      AND payment.payer_subject_hash = ${input.session.subject}
      AND intent.wallet_id = ${input.walletId}
    ORDER BY payment.created_at DESC LIMIT 80
  `;
  return Promise.all(rows.map(async (row) => {
    try { return view(await reconcile(row)); }
    catch (error) {
      console.warn('wss_qr_reconcile_failed', { paymentRequestId: row.id,
        code: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : error instanceof Error ? error.name : 'unknown' });
      return view(row);
    }
  }));
}

export async function assertQrPaymentMatches(request: PrepareTransferRequest): Promise<void> {
  if (!request.paymentRequestId) return;
  const row = await paymentRow(request.paymentRequestId);
  if (!matchesQrPayment(request, row)) {
    throw new Error('payment_request_mismatch');
  }
}

export function matchesQrPayment(request: PrepareTransferRequest, row: Pick<PaymentRow,
  'status' | 'expires_at' | 'chain_id' | 'asset_id' | 'amount_atomic' | 'recipient_address'>, now = Date.now()): boolean {
  return row.status === 'pending' && row.expires_at.getTime() > now
    && request.channel === 'address' && !request.destinationWalletId
    && request.chainId === row.chain_id && request.assetId === row.asset_id
    && request.amountAtomic === row.amount_atomic
    && request.recipient.toLowerCase() === row.recipient_address.toLowerCase();
}

export async function bindQrPaymentIntent(input: {
  session: Session; paymentRequestId: string; intentId: string; expiresAt: string;
}): Promise<void> {
  const rows = await database()<PaymentRow[]>`
    UPDATE wss_qr_payment_requests
    SET status = 'reserved', payer_tenant_id = ${input.session.tenantId},
      payer_subject_hash = ${input.session.subject}, transfer_intent_id = ${input.intentId},
      reserved_until = ${input.expiresAt}, updated_at = now()
    WHERE id = ${input.paymentRequestId} AND status = 'pending' AND expires_at > now()
    RETURNING *
  `;
  if (!rows.length) throw new Error('payment_request_unavailable');
}

export async function markQrPaymentSubmitted(input: { intentId: string; transactionHash?: string }): Promise<void> {
  if (!sql) return;
  await database()`
    UPDATE wss_qr_payment_requests SET status = 'submitted',
      transaction_hash = COALESCE(${input.transactionHash ?? null}, transaction_hash), updated_at = now()
    WHERE transfer_intent_id = ${input.intentId} AND status = 'reserved'
  `;
}
