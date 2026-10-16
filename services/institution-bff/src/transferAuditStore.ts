import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type {
  PrepareTransferRequest,
  PreparedTransfer,
  SubmitTransferRequest,
  TransferExecutionResult,
  TransferActivityItem,
  WssSessionClaims,
} from '@took-wss/contracts';
import { phoneEscrowClaimUrl } from './phoneEscrowService.js';

type Session = Omit<WssSessionClaims, 'nonce'>;

const databaseUrl = process.env.DATABASE_URL?.trim();
const sql = databaseUrl && !process.env.VITEST
  ? postgres(databaseUrl, { max: 3, prepare: false, idle_timeout: 20 })
  : null;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function reserveSolanaSponsor(input: { session: Session; intentId: string }): Promise<void> {
  if (!sql) {
    if (process.env.NODE_ENV === 'production') throw new Error('solana_sponsor_budget_unavailable');
    return;
  }
  await sql.begin(async (transaction) => {
    await transaction`
      SELECT pg_advisory_xact_lock(hashtext('wss-solana-sponsor-global'))
    `;
    const existing = await transaction<{ transfer_intent_id: string }[]>`
      SELECT transfer_intent_id FROM wss_solana_sponsor_reservations
      WHERE tenant_id = ${input.session.tenantId} AND transfer_intent_id = ${input.intentId}
    `;
    if (existing.length) return;
    const count = await transaction<{ used: string }[]>`
      SELECT count(*)::text AS used FROM wss_solana_sponsor_reservations
      WHERE tenant_id = ${input.session.tenantId}
        AND subject_hash = ${input.session.subject}
        AND reserved_day = (now() AT TIME ZONE 'UTC')::date
    `;
    if (Number(count[0]?.used ?? '0') >= 3) throw new Error('solana_sponsor_daily_limit');
    const globalCount = await transaction<{ used: string }[]>`
      SELECT count(*)::text AS used FROM wss_solana_sponsor_reservations
      WHERE reserved_day = (now() AT TIME ZONE 'UTC')::date
    `;
    if (Number(globalCount[0]?.used ?? '0') >= 20) throw new Error('solana_sponsor_daily_limit');
    await transaction`
      INSERT INTO wss_solana_sponsor_reservations (tenant_id, transfer_intent_id, subject_hash)
      VALUES (${input.session.tenantId}, ${input.intentId}, ${input.session.subject})
    `;
  });
}

export async function recordPreparedTransfer(input: {
  session: Session;
  request: PrepareTransferRequest;
  prepared: PreparedTransfer;
  phoneEscrow?: { commitment: string; escrowAddress: string; senderAddress: string; tokenAddress: string; amountAtomic: string };
}): Promise<void> {
  if (!sql) {
    if (process.env.NODE_ENV === 'production') throw new Error('transfer_audit_store_required');
    return;
  }
  const { session, request, prepared } = input;
  const reason = request.complianceReason?.trim();
  const recipientReference = request.channel === 'address'
    ? prepared.recipient
    : `${request.channel}:${hash(`${session.tenantId}\u0000${request.recipient.replace(/\D/g, '')}`)}`;
  const status = prepared.compliance.status === 'block' || prepared.compliance.status === 'unavailable'
    ? 'blocked'
    : prepared.signingRequest ? 'approval-required' : 'prepared';
  await sql`
    INSERT INTO wss_transfer_intents (
      id, tenant_id, wallet_id, session_id_hash, subject_hash,
      chain_id, asset_id, asset_symbol, from_address, recipient_address, transfer_channel,
      amount_atomic, network_fee_atomic, compliance_status,
      compliance_risk_level, compliance_risk_score,
      compliance_reason_recorded, compliance_reason_hash,
      gas_sponsorship_status, signing_payload_hash, status, expires_at,
      prepared_payload, phone_escrow_reference
    ) VALUES (
      ${prepared.intentId}, ${session.tenantId}, ${prepared.walletId}, ${hash(session.sessionId)}, ${session.subject},
      ${prepared.chainId}, ${prepared.assetId}, ${prepared.assetSymbol}, ${prepared.fromAddress}, ${recipientReference}, ${request.channel},
      ${prepared.amountAtomic}, ${prepared.networkFee.amountAtomic}, ${prepared.compliance.status},
      ${prepared.compliance.riskLevel ?? null}, ${prepared.compliance.riskScore ?? null},
      ${Boolean(reason)}, ${reason ? hash(reason) : null},
      ${prepared.gasSponsorship.status}, ${prepared.signingRequest ? hash(JSON.stringify(prepared.signingRequest)) : null},
      ${status}, ${prepared.expiresAt},
      ${sql.json(JSON.parse(JSON.stringify(prepared)))}, ${input.phoneEscrow ? sql.json(input.phoneEscrow) : null}
    )
  `;
}

export async function loadPreparedTransfer(input: {
  session: Session;
  intentId: string;
}): Promise<{ prepared: PreparedTransfer; expiresAt: number; phoneEscrow?: { commitment: string; escrowAddress: string; senderAddress: string; tokenAddress: string; amountAtomic: string } } | null> {
  if (!sql) return null;
  const rows = await sql<{
    prepared_payload: PreparedTransfer | null;
    phone_escrow_reference: { commitment: string; escrowAddress: string; senderAddress: string; tokenAddress: string; amountAtomic: string } | null;
    expires_at: Date;
  }[]>`
    SELECT prepared_payload, phone_escrow_reference, expires_at
    FROM wss_transfer_intents
    WHERE tenant_id = ${input.session.tenantId}
      AND id = ${input.intentId}
      AND session_id_hash = ${hash(input.session.sessionId)}
      AND subject_hash = ${input.session.subject}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row?.prepared_payload || row.expires_at.getTime() <= Date.now()) return null;
  return {
    prepared: row.prepared_payload,
    expiresAt: row.expires_at.getTime(),
    ...(row.phone_escrow_reference ? { phoneEscrow: row.phone_escrow_reference } : {}),
  };
}

export async function loadSubmittedTransfer(input: {
  session: Session;
  intentId: string;
}): Promise<TransferExecutionResult | null> {
  if (!sql) return null;
  const rows = await sql<{ status: 'submitted' | 'confirmed'; transaction_hash: string }[]>`
    SELECT execution.status, execution.transaction_hash
    FROM wss_transfer_executions execution
    JOIN wss_transfer_intents intent
      ON intent.tenant_id = execution.tenant_id AND intent.id = execution.transfer_intent_id
    WHERE intent.tenant_id = ${input.session.tenantId}
      AND intent.id = ${input.intentId}
      AND intent.session_id_hash = ${hash(input.session.sessionId)}
      AND intent.subject_hash = ${input.session.subject}
      AND execution.status IN ('submitted', 'confirmed')
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { intentId: input.intentId, status: row.status, transactionHash: row.transaction_hash } : null;
}

export async function claimRelayTransfer(input: {
  session: Session;
  request: SubmitTransferRequest;
  authorizationId: string;
}): Promise<boolean> {
  if (!sql) {
    if (process.env.NODE_ENV === 'production') throw new Error('transfer_audit_store_required');
    return true;
  }
  return sql.begin(async (transaction) => {
    const inserted = await transaction<{ id: string }[]>`
      INSERT INTO wss_transfer_executions (
        id, tenant_id, transfer_intent_id, host_authorization_id,
        idempotency_key_hash, transaction_hash, status
      ) VALUES (
        ${randomUUID()}, ${input.session.tenantId}, ${input.request.intentId}, ${input.authorizationId},
        ${hash(input.request.idempotencyKey)}, null, 'processing'
      )
      ON CONFLICT (tenant_id, transfer_intent_id) DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) {
      await transaction`
        UPDATE wss_transfer_intents SET status = 'processing', updated_at = now()
        WHERE tenant_id = ${input.session.tenantId} AND id = ${input.request.intentId}
      `;
      return true;
    }
    const retried = await transaction<{ id: string }[]>`
      UPDATE wss_transfer_executions
      SET submitted_at = now()
      WHERE tenant_id = ${input.session.tenantId}
        AND transfer_intent_id = ${input.request.intentId}
        AND status = 'processing'
        AND transaction_hash IS NULL
        AND submitted_at < now() - interval '20 seconds'
      RETURNING id
    `;
    return retried.length > 0;
  });
}

export async function recordTransferReconciliation(input: {
  session: Session;
  intentId: string;
  status: 'processing' | 'submitted' | 'confirmed' | 'failed' | 'expired';
  transactionHash?: string;
}): Promise<void> {
  if (!sql) {
    if (process.env.NODE_ENV === 'production') throw new Error('transfer_audit_store_required');
    return;
  }
  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE wss_transfer_intents
      SET status = ${input.status},
        reconciled_transaction_hash = COALESCE(${input.transactionHash ?? null}, reconciled_transaction_hash),
        updated_at = now()
      WHERE tenant_id = ${input.session.tenantId}
        AND id = ${input.intentId}
        AND subject_hash = ${input.session.subject}
        AND status NOT IN ('confirmed', 'failed', 'expired')
    `;
    if (input.status !== 'expired') {
      await transaction`
        UPDATE wss_transfer_executions
        SET status = ${input.status},
          transaction_hash = COALESCE(${input.transactionHash ?? null}, transaction_hash),
          confirmed_at = CASE WHEN ${input.status} = 'confirmed' THEN now() ELSE confirmed_at END
        WHERE tenant_id = ${input.session.tenantId}
          AND transfer_intent_id = ${input.intentId}
          AND status NOT IN ('confirmed', 'failed')
      `;
    }
  });
}

interface TransferActivityRow {
  id: string;
  wallet_id: string;
  chain_id: string;
  asset_symbol: string;
  transfer_channel: 'address' | 'phone' | 'message';
  status: string;
  prepared_payload: PreparedTransfer | null;
  transaction_hash: string | null;
  phone_escrow_status: string | null;
  phone_escrow_sms_status: string | null;
  phone_escrow_claim_code: string | null;
  phone_escrow_expires_at: Date | null;
  created_at: Date;
}

function activityFromRow(row: TransferActivityRow): TransferActivityItem {
  const prepared = row.prepared_payload;
  if (!prepared) throw new Error('transfer_activity_payload_missing');
  const status = row.status === 'prepared' || row.status === 'blocked' ? 'approval-required' : row.status;
  if (status !== 'approval-required' && status !== 'processing' && status !== 'submitted'
    && status !== 'confirmed' && status !== 'failed' && status !== 'expired') throw new Error('transfer_activity_status_invalid');
  const escrowStatus = row.phone_escrow_status === 'claimed' ? 'claimed'
    : row.phone_escrow_status === 'claiming' ? 'claiming'
      : row.phone_escrow_status === 'refunding' ? 'refunding'
        : row.phone_escrow_status === 'refunded' ? 'refunded'
          : (row.phone_escrow_status === 'funded' || row.phone_escrow_status === 'notified' || row.phone_escrow_status === 'expired')
            ? row.phone_escrow_expires_at && row.phone_escrow_expires_at.getTime() <= Date.now() ? 'refund-available' : 'ready'
            : row.phone_escrow_status ? 'pending' : undefined;
  return {
    intentId: row.id,
    walletId: row.wallet_id,
    chainId: row.chain_id,
    network: prepared.network,
    assetSymbol: row.asset_symbol,
    amountDisplay: prepared.amountDisplay,
    ...(prepared.fiatDisplay ? { fiatDisplay: prepared.fiatDisplay } : {}),
    recipientDisplay: prepared.recipient,
    channel: row.transfer_channel,
    status,
    ...(prepared.gasSponsorship.method === 'evm-permit-relay' || prepared.gasSponsorship.method === 'solana-relay'
      ? { gasSponsorshipMethod: prepared.gasSponsorship.method } : {}),
    ...(row.transaction_hash ? { transactionHash: row.transaction_hash } : {}),
    ...(escrowStatus ? { phoneEscrowStatus: escrowStatus } : {}),
    ...(row.phone_escrow_sms_status && ['pending', 'sending', 'sent', 'failed', 'not-configured'].includes(row.phone_escrow_sms_status)
      ? { phoneEscrowSmsStatus: row.phone_escrow_sms_status as NonNullable<TransferActivityItem['phoneEscrowSmsStatus']> } : {}),
    ...(row.phone_escrow_claim_code && (escrowStatus === 'ready' || escrowStatus === 'claiming')
      ? { phoneEscrowClaimUrl: phoneEscrowClaimUrl(row.phone_escrow_claim_code) } : {}),
    createdAt: row.created_at.toISOString(),
  };
}

export async function getTransferActivity(input: { session: Session; intentId: string }): Promise<TransferActivityItem | null> {
  if (!sql) return null;
  const rows = await sql<TransferActivityRow[]>`
    SELECT intent.id, intent.wallet_id, intent.chain_id, intent.asset_symbol,
      intent.transfer_channel, intent.status, intent.prepared_payload,
      COALESCE(execution.transaction_hash, intent.reconciled_transaction_hash) AS transaction_hash,
      escrow.status AS phone_escrow_status, escrow.sms_status AS phone_escrow_sms_status,
      escrow.claim_code AS phone_escrow_claim_code, escrow.expires_at AS phone_escrow_expires_at,
      intent.created_at
    FROM wss_transfer_intents intent
    LEFT JOIN wss_transfer_executions execution
      ON execution.tenant_id = intent.tenant_id AND execution.transfer_intent_id = intent.id
    LEFT JOIN wss_phone_escrows escrow
      ON escrow.tenant_id = intent.tenant_id AND escrow.transfer_intent_id = intent.id
    WHERE intent.tenant_id = ${input.session.tenantId}
      AND intent.subject_hash = ${input.session.subject}
      AND intent.id = ${input.intentId}
    LIMIT 1
  `;
  return rows[0] ? activityFromRow(rows[0]) : null;
}

export async function listTransferActivity(input: { session: Session; walletId: string }): Promise<TransferActivityItem[]> {
  if (!sql) return [];
  const rows = await sql<TransferActivityRow[]>`
    SELECT intent.id, intent.wallet_id, intent.chain_id, intent.asset_symbol,
      intent.transfer_channel, intent.status, intent.prepared_payload,
      COALESCE(execution.transaction_hash, intent.reconciled_transaction_hash) AS transaction_hash,
      escrow.status AS phone_escrow_status, escrow.sms_status AS phone_escrow_sms_status,
      escrow.claim_code AS phone_escrow_claim_code, escrow.expires_at AS phone_escrow_expires_at,
      intent.created_at
    FROM wss_transfer_intents intent
    LEFT JOIN wss_transfer_executions execution
      ON execution.tenant_id = intent.tenant_id AND execution.transfer_intent_id = intent.id
    LEFT JOIN wss_phone_escrows escrow
      ON escrow.tenant_id = intent.tenant_id AND escrow.transfer_intent_id = intent.id
    WHERE intent.tenant_id = ${input.session.tenantId}
      AND intent.subject_hash = ${input.session.subject}
      AND intent.wallet_id = ${input.walletId}
      AND intent.status NOT IN ('prepared', 'blocked')
      AND (intent.status <> 'approval-required' OR execution.id IS NOT NULL)
    ORDER BY intent.created_at DESC
    LIMIT 40
  `;
  return rows.map(activityFromRow);
}

export async function recordAuthorizedTransfer(input: {
  session: Session;
  request: SubmitTransferRequest;
  authorizationId: string;
  transactionHash: string;
}): Promise<void> {
  if (!sql) {
    if (process.env.NODE_ENV === 'production') throw new Error('transfer_audit_store_required');
    return;
  }
  const { session, request, authorizationId, transactionHash } = input;
  await sql.begin(async (transaction) => {
    const inserted = await transaction<{ transaction_hash: string }[]>`
      INSERT INTO wss_transfer_executions (
        id, tenant_id, transfer_intent_id, host_authorization_id,
        idempotency_key_hash, transaction_hash, status
      ) VALUES (
        ${randomUUID()}, ${session.tenantId}, ${request.intentId}, ${authorizationId},
        ${hash(request.idempotencyKey)}, ${transactionHash}, 'approved'
      )
      ON CONFLICT (tenant_id, transfer_intent_id) DO NOTHING
      RETURNING transaction_hash
    `;
    if (inserted.length === 0) {
      const existing = await transaction<{ transaction_hash: string }[]>`
        SELECT transaction_hash
        FROM wss_transfer_executions
        WHERE tenant_id = ${session.tenantId} AND transfer_intent_id = ${request.intentId}
        FOR UPDATE
      `;
      if (existing[0]?.transaction_hash !== transactionHash) throw new Error('transfer_intent_already_executed');
    }
    await transaction`
      UPDATE wss_transfer_intents
      SET status = 'approval-required', updated_at = now()
      WHERE tenant_id = ${session.tenantId} AND id = ${request.intentId}
    `;
  });
}

export async function recordSubmittedTransfer(input: {
  session: Session;
  intentId: string;
  result: TransferExecutionResult;
}): Promise<void> {
  if (!sql) {
    if (process.env.NODE_ENV === 'production') throw new Error('transfer_audit_store_required');
    return;
  }
  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE wss_transfer_executions
      SET status = ${input.result.status}, submitted_at = now()
      WHERE tenant_id = ${input.session.tenantId} AND transfer_intent_id = ${input.intentId}
    `;
    await transaction`
      UPDATE wss_transfer_intents
      SET status = ${input.result.status}, updated_at = now()
      WHERE tenant_id = ${input.session.tenantId} AND id = ${input.intentId}
    `;
  });
}
