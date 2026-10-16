import { timingSafeEqual } from 'node:crypto';
import { ethers } from 'ethers';
import postgres from 'postgres';
import { formatUnits, nativeAssetConfig, nativeAssetRpcUrl } from './assetPortfolio.js';
import { stablecoinByAssetId } from './stablecoinRegistry.js';
import { koreanPhoneE164, phoneLookupHash } from './phoneRegistration.js';
import { normalizePhoneEscrowRecipient } from './phoneEscrowService.js';
import { SupabasePhoneAuthClient } from './supabasePhoneAuth.js';
import { requestBrandedPhoneOtp } from './smsDeliveryContext.js';
import { smsBrandForTenant } from './smsTenantBrand.js';
import { screenRecipient } from './transferService.js';
import type { WssSessionClaims } from '@took-wss/contracts';

const databaseUrl = process.env.DATABASE_URL?.trim();
const sql = databaseUrl && !process.env.VITEST
  ? postgres(databaseUrl, { max: 3, prepare: false, idle_timeout: 20 }) : null;
const escrowInterface = new ethers.Interface([
  'function deposits(bytes32) view returns (address sender,address token,uint256 amount,uint64 expiry,bool isClaimed)',
  'event Claimed(bytes32 indexed commitment,address indexed recipient,address indexed relayer,uint256 payout,uint256 fee)',
]);

interface ClaimRow {
  id: string;
  tenant_id: string;
  commitment: string;
  chain_id: string;
  evm_chain_id: number;
  escrow_contract_address: string;
  token_contract_address: string;
  recipient_amount_atomic: string;
  escrow_amount_atomic: string;
  recipient_lookup_hash: Buffer;
  status: string;
  sms_status: string;
  expires_at: Date;
  claim_started_at: Date | null;
  claim_recipient_address: string | null;
  claim_transaction_hash: string | null;
  claim_start_block: string | null;
  claim_scan_block: string | null;
  claim_payout_atomic: string | null;
  claim_fee_atomic_actual: string | null;
  from_address: string;
  asset_symbol: string;
  asset_id: string;
  amount_display: string | null;
}

export class PhoneClaimError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}

/** The claim phone must already belong to the customer behind this institution session. */
export async function assertInstitutionClaimPhone(session: Omit<WssSessionClaims, 'nonce'>, rawPhone: string): Promise<string> {
  const phone = normalizePhoneEscrowRecipient(rawPhone);
  const secret = process.env.WSS_PHONE_LOOKUP_SECRET?.trim();
  if (!secret) throw new PhoneClaimError('claim_service_unavailable', 503);
  const rows = await requiredSql()`
    SELECT 1 FROM wss_external_identities identity
    JOIN wss_user_profiles profile ON profile.tenant_id = identity.tenant_id
      AND profile.id = identity.user_profile_id
    JOIN wss_user_private_attributes attributes ON attributes.tenant_id = profile.tenant_id
      AND attributes.user_profile_id = profile.id
    WHERE identity.tenant_id = ${session.tenantId}
      AND identity.issuer = 'institution-host'
      AND identity.subject_version = ${session.subjectVersion}
      AND identity.subject_hash = ${session.subject}
      AND identity.revoked_at IS NULL AND profile.status = 'active'
      AND attributes.phone_possession_verified_at IS NOT NULL
      AND attributes.phone_lookup_hash = ${phoneLookupHash(session.tenantId, phone, secret)}
    LIMIT 1
  `;
  if (!rows.length) throw new PhoneClaimError('institution_phone_mismatch', 403);
  return phone;
}

function requiredSql() {
  if (!sql) throw new PhoneClaimError('claim_service_unavailable', 503);
  return sql;
}

function validCode(code: string): string {
  if (!/^[A-Za-z0-9_-]{12}$/.test(code)) throw new PhoneClaimError('claim_not_found', 404);
  return code;
}

async function claimRow(code: string): Promise<ClaimRow> {
  const db = requiredSql();
  const rows = await db<ClaimRow[]>`
    SELECT escrow.id, escrow.tenant_id, escrow.commitment, escrow.chain_id,
      escrow.evm_chain_id, escrow.escrow_contract_address, escrow.token_contract_address,
      escrow.recipient_amount_atomic, escrow.escrow_amount_atomic,
      escrow.recipient_lookup_hash, escrow.status, escrow.sms_status, escrow.expires_at,
      escrow.claim_started_at, escrow.claim_recipient_address, escrow.claim_transaction_hash,
      escrow.claim_start_block, escrow.claim_scan_block,
      escrow.claim_payout_atomic, escrow.claim_fee_atomic_actual,
      intent.from_address, intent.asset_symbol, intent.asset_id,
      intent.prepared_payload->'phoneEscrow'->>'recipientAmountDisplay' AS amount_display
    FROM wss_phone_escrows escrow
    JOIN wss_transfer_intents intent ON intent.tenant_id = escrow.tenant_id
      AND intent.id = escrow.transfer_intent_id
    WHERE escrow.claim_code = ${validCode(code)}
    LIMIT 1
  `;
  if (!rows[0]) throw new PhoneClaimError('claim_not_found', 404);
  return rows[0];
}

function publicStatus(row: ClaimRow): string {
  if (row.status === 'claimed' || row.status === 'refunded' || row.status === 'expired') return row.status;
  if (row.status === 'claiming') return 'processing';
  if (row.expires_at.getTime() <= Date.now()) return 'expired';
  if (row.status === 'funded' || row.status === 'notified') return 'ready';
  return 'pending';
}

async function reconcileClaim(row: ClaimRow): Promise<ClaimRow> {
  if (row.status !== 'claiming') return row;
  const rpc = nativeAssetRpcUrl(row.chain_id);
  if (!rpc) return row;
  try {
    const provider = new ethers.JsonRpcProvider(rpc, row.evm_chain_id, { staticNetwork: true });
    if (row.claim_transaction_hash) {
      const receipt = await provider.getTransactionReceipt(row.claim_transaction_hash);
      if (receipt?.status === 1) {
        const matched = receipt.logs.map((log) => {
          if (log.address.toLowerCase() !== row.escrow_contract_address.toLowerCase()) return false;
          try {
            const event = escrowInterface.parseLog(log);
            return event?.name === 'Claimed'
              && String(event.args.commitment).toLowerCase() === row.commitment.toLowerCase()
              && String(event.args.recipient).toLowerCase() === row.claim_recipient_address?.toLowerCase()
              ? { payout: BigInt(event.args.payout), fee: BigInt(event.args.fee) } : false;
          } catch { return false; }
        }).find((value) => value !== false);
        if (matched) {
          await requiredSql()`
            UPDATE wss_phone_escrows SET status = 'claimed', claimed_at = now(),
              claim_payout_atomic = ${matched.payout.toString()},
              claim_fee_atomic_actual = ${matched.fee.toString()}, updated_at = now()
            WHERE id = ${row.id} AND status = 'claiming'
          `;
          row.status = 'claimed';
          row.claim_payout_atomic = matched.payout.toString();
          row.claim_fee_atomic_actual = matched.fee.toString();
        }
      } else if (receipt?.status === 0) {
        await requiredSql()`
          UPDATE wss_phone_escrows
          SET status = CASE WHEN sms_status = 'sent' THEN 'notified' ELSE 'funded' END,
            claim_started_at = NULL, claim_recipient_address = NULL, claim_transaction_hash = NULL,
            updated_at = now()
          WHERE id = ${row.id} AND status = 'claiming'
        `;
        row.status = row.sms_status === 'sent' ? 'notified' : 'funded';
      }
    } else if (row.claim_started_at && Date.now() - row.claim_started_at.getTime() > 120_000) {
      const result = await provider.call({ to: row.escrow_contract_address, data: escrowInterface.encodeFunctionData('deposits', [row.commitment]) });
      const deposit = escrowInterface.decodeFunctionResult('deposits', result);
      if (String(deposit.sender).toLowerCase() === ethers.ZeroAddress.toLowerCase()
        && row.expires_at.getTime() <= Date.now()) {
        await requiredSql()`
          UPDATE wss_phone_escrows SET status = 'expired', updated_at = now()
          WHERE id = ${row.id} AND status = 'claiming' AND claim_transaction_hash IS NULL
        `;
        row.status = 'expired';
      } else if (!deposit.isClaimed) {
        await requiredSql()`
          UPDATE wss_phone_escrows
          SET status = CASE WHEN sms_status = 'sent' THEN 'notified' ELSE 'funded' END,
            claim_started_at = NULL, claim_recipient_address = NULL, updated_at = now()
          WHERE id = ${row.id} AND status = 'claiming' AND claim_transaction_hash IS NULL
        `;
        row.status = row.sms_status === 'sent' ? 'notified' : 'funded';
      } else if (row.claim_start_block !== null && row.claim_recipient_address) {
        const fromBlock = Number(row.claim_scan_block ?? row.claim_start_block);
        const latestBlock = await provider.getBlockNumber();
        if (!Number.isSafeInteger(fromBlock) || fromBlock < 0 || fromBlock > latestBlock) return row;
        const toBlock = Math.min(latestBlock, fromBlock + 1_999);
        const logs = await provider.getLogs({
          address: row.escrow_contract_address,
          fromBlock, toBlock,
          topics: escrowInterface.encodeFilterTopics('Claimed', [row.commitment]),
        });
        const matched = logs.map((log) => {
          try {
            const event = escrowInterface.parseLog(log);
            return event?.name === 'Claimed'
              && String(event.args.recipient).toLowerCase() === row.claim_recipient_address?.toLowerCase()
              ? { hash: log.transactionHash, payout: BigInt(event.args.payout), fee: BigInt(event.args.fee) } : false;
          } catch { return false; }
        }).find((value) => value !== false);
        if (matched) {
          await requiredSql()`
            UPDATE wss_phone_escrows SET status = 'claimed', claimed_at = now(),
              claim_transaction_hash = ${matched.hash.toLowerCase()},
              claim_payout_atomic = ${matched.payout.toString()},
              claim_fee_atomic_actual = ${matched.fee.toString()}, updated_at = now()
            WHERE id = ${row.id} AND status = 'claiming' AND claim_transaction_hash IS NULL
          `;
          row.status = 'claimed';
          row.claim_transaction_hash = matched.hash.toLowerCase();
          row.claim_payout_atomic = matched.payout.toString();
          row.claim_fee_atomic_actual = matched.fee.toString();
        } else if (toBlock < latestBlock) {
          await requiredSql()`
            UPDATE wss_phone_escrows SET claim_scan_block = ${toBlock + 1}, updated_at = now()
            WHERE id = ${row.id} AND status = 'claiming' AND claim_transaction_hash IS NULL
          `;
          row.claim_scan_block = String(toBlock + 1);
        }
      }
    }
  } catch { /* keep the durable processing state until the chain can be checked */ }
  return row;
}

export async function getPhoneClaimInfo(code: string) {
  const row = await reconcileClaim(await claimRow(code));
  const decimals = row.token_contract_address === ethers.ZeroAddress
    ? nativeAssetConfig(row.chain_id)?.decimals
    : stablecoinByAssetId(row.asset_id)?.decimals;
  const payoutDisplay = row.claim_payout_atomic && decimals !== undefined
    ? formatUnits(BigInt(row.claim_payout_atomic), decimals, decimals) : undefined;
  return {
    status: publicStatus(row), network: row.chain_id, assetSymbol: row.asset_symbol,
    amountDisplay: row.amount_display ?? row.recipient_amount_atomic,
    expiresAt: row.expires_at.toISOString(),
    ...(payoutDisplay ? { payoutDisplay, payoutBelowExpected: BigInt(row.claim_payout_atomic!) < BigInt(row.recipient_amount_atomic) } : {}),
    ...(row.status === 'claimed' && row.claim_transaction_hash ? { transactionHash: row.claim_transaction_hash } : {}),
  };
}

function matchingPhone(row: ClaimRow, phone: string): boolean {
  const secret = process.env.WSS_PHONE_LOOKUP_SECRET?.trim();
  if (!secret) throw new PhoneClaimError('claim_service_unavailable', 503);
  const actual = phoneLookupHash(row.tenant_id, phone, secret);
  return actual.length === row.recipient_lookup_hash.length && timingSafeEqual(actual, row.recipient_lookup_hash);
}

function phoneAuth() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !key) throw new PhoneClaimError('claim_service_unavailable', 503);
  return new SupabasePhoneAuthClient(url, key);
}

export async function requestPhoneClaimOtp(code: string, rawPhone: string, brandTenantId?: string): Promise<void> {
  const row = await claimRow(code);
  if (publicStatus(row) !== 'ready') throw new PhoneClaimError('claim_not_ready', 409);
  const phone = normalizePhoneEscrowRecipient(rawPhone);
  if (!matchingPhone(row, phone)) throw new PhoneClaimError('claim_phone_mismatch', 403);
  const updated = await requiredSql()`
    UPDATE wss_phone_escrows
    SET otp_request_count = otp_request_count + 1, otp_last_requested_at = now(), updated_at = now()
    WHERE id = ${row.id} AND status IN ('funded', 'notified')
      AND otp_request_count < 5
      AND (otp_last_requested_at IS NULL OR otp_last_requested_at < now() - interval '60 seconds')
    RETURNING id
  `;
  if (!updated.length) throw new PhoneClaimError('claim_otp_rate_limited', 429);
  await requestBrandedPhoneOtp(
    requiredSql(),
    phoneAuth(),
    koreanPhoneE164(phone),
    smsBrandForTenant(brandTenantId ?? row.tenant_id),
    process.env.WSS_PHONE_LOOKUP_SECRET?.trim() || '',
  );
}

async function callClaimRelay(row: ClaimRow, recipient: string): Promise<string> {
  const url = process.env.WSS_TOOK_PHONE_CLAIM_URL?.trim();
  const key = process.env.WSS_TOOK_PHONE_CLAIM_KEY?.trim();
  const anon = process.env.WSS_TOOK_PHONE_CLAIM_ANON_KEY?.trim();
  if (!url || !key || !anon) throw new PhoneClaimError('claim_service_unavailable', 503);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}`, 'x-wss-claim-key': key },
      body: JSON.stringify({
        chainKey: row.chain_id, commitment: row.commitment,
        escrowAddress: row.escrow_contract_address, sender: row.from_address,
        token: row.token_contract_address, amountAtomic: row.escrow_amount_atomic,
        minimumPayoutAtomic: row.recipient_amount_atomic,
        expirySeconds: Math.floor(row.expires_at.getTime() / 1000), recipient,
      }),
    });
    const result = await response.json() as { transactionHash?: unknown };
    if (!response.ok || typeof result.transactionHash !== 'string'
      || !/^0x[0-9a-fA-F]{64}$/.test(result.transactionHash)) throw new Error('claim_relay_unavailable');
    return result.transactionHash;
  } finally { clearTimeout(timeout); }
}

export async function submitPhoneClaim(input: { code: string; phone: string; otp: string; recipient: string }) {
  const row = await reconcileClaim(await claimRow(input.code));
  if (publicStatus(row) !== 'ready') throw new PhoneClaimError('claim_not_ready', 409);
  const phone = normalizePhoneEscrowRecipient(input.phone);
  if (!matchingPhone(row, phone)) throw new PhoneClaimError('claim_phone_mismatch', 403);
  if (!/^\d{6}$/.test(input.otp)) throw new PhoneClaimError('invalid_otp');
  if (!ethers.isAddress(input.recipient)) throw new PhoneClaimError('invalid_recipient');
  const recipient = ethers.getAddress(input.recipient);
  if (recipient.toLowerCase() === row.from_address.toLowerCase()) throw new PhoneClaimError('self_claim_not_allowed');
  const auth = phoneAuth();
  const verified = await auth.verifyOtp(koreanPhoneE164(phone), input.otp);
  try {
    if (!matchingPhone(row, verified.phone)) throw new PhoneClaimError('claim_phone_mismatch', 403);
  } finally { await auth.revoke(verified.accessToken); }
  const compliance = await screenRecipient(row.chain_id, recipient, 0);
  if (compliance.status !== 'allow') throw new PhoneClaimError('recipient_review_required', 403);
  const rpc = nativeAssetRpcUrl(row.chain_id);
  if (!rpc) throw new PhoneClaimError('claim_service_unavailable', 503);
  const provider = new ethers.JsonRpcProvider(rpc, row.evm_chain_id, { staticNetwork: true });
  let startBlock: number;
  try { startBlock = Math.max(0, await provider.getBlockNumber() - 6); }
  catch { throw new PhoneClaimError('claim_service_unavailable', 503); }
  const claimed = await requiredSql()`
    UPDATE wss_phone_escrows
    SET status = 'claiming', claim_recipient_address = ${recipient}, claim_started_at = now(),
      claim_start_block = ${startBlock}, claim_scan_block = ${startBlock}, updated_at = now()
    WHERE id = ${row.id} AND status IN ('funded', 'notified') AND expires_at > now()
    RETURNING id
  `;
  if (!claimed.length) throw new PhoneClaimError('claim_not_ready', 409);
  try {
    const transactionHash = await callClaimRelay(row, recipient);
    await requiredSql()`
      UPDATE wss_phone_escrows SET claim_transaction_hash = ${transactionHash.toLowerCase()}, updated_at = now()
      WHERE id = ${row.id} AND status = 'claiming'
    `;
    return { status: 'processing', transactionHash };
  } catch {
    return { status: 'processing' };
  }
}
