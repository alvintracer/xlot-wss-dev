import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import type {
  ExchangeExecutionResult,
  PreparedExchange,
  SubmitExchangeRequest,
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

export async function recordPreparedExchange(input: {
  session: Session;
  prepared: PreparedExchange;
  provider: string;
}): Promise<void> {
  if (!sql) {
    if (process.env.NODE_ENV === 'production') throw new Error('exchange_audit_store_required');
    return;
  }
  const { session, prepared } = input;
  await sql`
    INSERT INTO wss_exchange_intents (
      id, tenant_id, wallet_id, session_id_hash, subject_hash,
      quote_id, provider, chain_id, quote_mode,
      sell_asset_id, sell_asset_symbol, sell_amount_atomic,
      buy_asset_id, buy_asset_symbol, buy_amount_atomic,
      minimum_buy_amount_atomic, maximum_sell_amount_atomic,
      network_fee_atomic, signing_payload_hash, stage, status, expires_at
    ) VALUES (
      ${prepared.intentId}, ${session.tenantId}, ${prepared.walletId}, ${hash(session.sessionId)}, ${session.subject},
      ${prepared.quoteId}, ${input.provider}, ${prepared.chainId}, ${prepared.mode},
      ${prepared.sell.assetId}, ${prepared.sell.symbol}, ${prepared.sell.amountAtomic},
      ${prepared.buy.assetId}, ${prepared.buy.symbol}, ${prepared.buy.amountAtomic},
      ${prepared.minimumBuyAmountAtomic ?? null}, ${prepared.maximumSellAmountAtomic ?? null},
      ${prepared.networkFee.amountAtomic}, ${hash(JSON.stringify(prepared.signingRequest))}, ${prepared.stage}, 'approval-required', ${prepared.expiresAt}
    )
  `;
}

export async function recordAuthorizedExchange(input: {
  session: Session;
  request: SubmitExchangeRequest;
  authorizationId: string;
  transactionHash: string;
}): Promise<void> {
  if (!sql) {
    if (process.env.NODE_ENV === 'production') throw new Error('exchange_audit_store_required');
    return;
  }
  await sql.begin(async (transaction) => {
    const inserted = await transaction<{ transaction_hash: string }[]>`
      INSERT INTO wss_exchange_executions (
        id, tenant_id, exchange_intent_id, host_authorization_id,
        idempotency_key_hash, transaction_hash, status
      ) VALUES (
        ${randomUUID()}, ${input.session.tenantId}, ${input.request.intentId}, ${input.authorizationId},
        ${hash(input.request.idempotencyKey)}, ${input.transactionHash}, 'approved'
      )
      ON CONFLICT (tenant_id, exchange_intent_id) DO NOTHING
      RETURNING transaction_hash
    `;
    if (inserted.length === 0) {
      const existing = await transaction<{ transaction_hash: string }[]>`
        SELECT transaction_hash
        FROM wss_exchange_executions
        WHERE tenant_id = ${input.session.tenantId} AND exchange_intent_id = ${input.request.intentId}
        FOR UPDATE
      `;
      if (existing[0]?.transaction_hash !== input.transactionHash) throw new Error('exchange_intent_already_executed');
    }
  });
}

export async function recordSubmittedExchange(input: {
  session: Session;
  intentId: string;
  result: ExchangeExecutionResult;
}): Promise<void> {
  if (!sql) {
    if (process.env.NODE_ENV === 'production') throw new Error('exchange_audit_store_required');
    return;
  }
  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE wss_exchange_executions
      SET status = ${input.result.status}, submitted_at = now()
      WHERE tenant_id = ${input.session.tenantId} AND exchange_intent_id = ${input.intentId}
    `;
    await transaction`
      UPDATE wss_exchange_intents
      SET status = ${input.result.status}, updated_at = now()
      WHERE tenant_id = ${input.session.tenantId} AND id = ${input.intentId}
    `;
  });
}

export async function readExchangeExecution(input: { session: Session; intentId: string }): Promise<{
  chainId: string;
  stage: 'allowance' | 'swap';
  status: 'approved' | 'submitted' | 'allowance-confirmed' | 'confirmed' | 'failed';
  transactionHash: string;
} | null> {
  if (!sql) return null;
  const rows = await sql<{ chain_id: string; stage: 'allowance' | 'swap'; status: 'approved' | 'submitted' | 'allowance-confirmed' | 'confirmed' | 'failed'; transaction_hash: string }[]>`
    SELECT intent.chain_id, intent.stage, execution.status, execution.transaction_hash
    FROM wss_exchange_intents AS intent
    JOIN wss_exchange_executions AS execution
      ON execution.tenant_id = intent.tenant_id AND execution.exchange_intent_id = intent.id
    WHERE intent.tenant_id = ${input.session.tenantId}
      AND intent.subject_hash = ${input.session.subject}
      AND intent.id = ${input.intentId}
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { chainId: row.chain_id, stage: row.stage, status: row.status, transactionHash: row.transaction_hash } : null;
}

export async function recordExchangeReceipt(input: {
  session: Session;
  intentId: string;
  transactionHash: string;
  status: 'allowance-confirmed' | 'confirmed' | 'failed';
}): Promise<void> {
  if (!sql) return;
  await sql.begin(async (transaction) => {
    await transaction`
      UPDATE wss_exchange_executions
      SET status = ${input.status}, confirmed_at = now()
      WHERE tenant_id = ${input.session.tenantId}
        AND exchange_intent_id = ${input.intentId}
        AND transaction_hash = ${input.transactionHash}
        AND status IN ('approved', 'submitted', ${input.status})
    `;
    await transaction`
      UPDATE wss_exchange_intents
      SET status = ${input.status}, updated_at = now()
      WHERE tenant_id = ${input.session.tenantId}
        AND id = ${input.intentId}
    `;
  });
}
