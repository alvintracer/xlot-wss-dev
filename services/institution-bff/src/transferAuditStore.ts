import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type {
  PrepareTransferRequest,
  PreparedTransfer,
  SubmitTransferRequest,
  TransferExecutionResult,
  WssSessionClaims,
} from '@took-wss/contracts';

type Session = Omit<WssSessionClaims, 'nonce'>;

const databaseUrl = process.env.DATABASE_URL?.trim();
const sql = databaseUrl && !process.env.VITEST
  ? postgres(databaseUrl, { max: 3, prepare: false, idle_timeout: 20 })
  : null;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export async function recordPreparedTransfer(input: {
  session: Session;
  request: PrepareTransferRequest;
  prepared: PreparedTransfer;
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
      gas_sponsorship_status, signing_payload_hash, status, expires_at
    ) VALUES (
      ${prepared.intentId}, ${session.tenantId}, ${prepared.walletId}, ${hash(session.sessionId)}, ${session.subject},
      ${prepared.chainId}, ${prepared.assetId}, ${prepared.assetSymbol}, ${prepared.fromAddress}, ${recipientReference}, ${request.channel},
      ${prepared.amountAtomic}, ${prepared.networkFee.amountAtomic}, ${prepared.compliance.status},
      ${prepared.compliance.riskLevel ?? null}, ${prepared.compliance.riskScore ?? null},
      ${Boolean(reason)}, ${reason ? hash(reason) : null},
      ${prepared.gasSponsorship.status}, ${prepared.signingRequest ? hash(JSON.stringify(prepared.signingRequest)) : null},
      ${status}, ${prepared.expiresAt}
    )
  `;
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
