import { randomUUID } from 'node:crypto';
import postgres from 'postgres';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');

class VerificationRollback extends Error {
  constructor(count) {
    super('Rollback address-sharing verification fixture.');
    this.count = count;
  }
}

const sql = postgres(process.env.DATABASE_URL, { max: 1, prepare: false });
const profileId = randomUUID();
const walletId = randomUUID();

try {
  let matchingAddressCount = 0;
  try {
    await sql.begin(async (transaction) => {
      const [metadata] = await transaction`
        SELECT project_name, environment, purpose FROM wss_deployment_metadata WHERE singleton = true
      `;
      if (metadata?.project_name !== 'xlot-wss-dev'
        || metadata.environment !== 'development'
        || metadata.purpose !== 'proposal-and-early-function-sandbox') {
        throw new Error('Refusing address-sharing verification outside xlot-wss-dev.');
      }
      const [source] = await transaction`
        SELECT account.chain_id, account.address_group_id, account.address_normalized,
          account.address_display, wallet.key_policy_version
        FROM wss_wallet_accounts account
        JOIN wss_wallets wallet ON wallet.tenant_id = account.tenant_id AND wallet.id = account.wallet_id
        WHERE account.tenant_id = 'kiwoom'
        LIMIT 1
      `;
      if (!source) throw new Error('No existing account to verify address sharing.');

      await transaction`
        INSERT INTO wss_user_profiles (id, tenant_id, status, assurance_level)
        VALUES (${profileId}, 'kiwoom', 'active', 'phone-possession')
      `;
      await transaction`
        INSERT INTO wss_wallets (
          id, tenant_id, user_profile_id, key_policy_version, key_adapter,
          provisioning_origin, status, label, provisioning_idempotency_key
        ) VALUES (
          ${walletId}, 'kiwoom', ${profileId}, ${source.key_policy_version},
          'took-sar', 'imported', 'active', '검증 후 롤백', ${randomUUID()}
        )
      `;
      await transaction`
        INSERT INTO wss_wallet_accounts (
          id, tenant_id, wallet_id, chain_id, address_group_id,
          address_normalized, address_display
        ) VALUES (
          ${randomUUID()}, 'kiwoom', ${walletId}, ${source.chain_id},
          ${source.address_group_id}, ${source.address_normalized}, ${source.address_display}
        )
      `;
      const [result] = await transaction`
        SELECT count(*)::int AS count FROM wss_wallet_accounts
        WHERE tenant_id = 'kiwoom'
          AND chain_id = ${source.chain_id}
          AND address_normalized = ${source.address_normalized}
      `;
      throw new VerificationRollback(result.count);
    });
  } catch (error) {
    if (!(error instanceof VerificationRollback)) throw error;
    matchingAddressCount = error.count;
  }
  const [remaining] = await sql`
    SELECT
      (SELECT count(*)::int FROM wss_user_profiles WHERE id = ${profileId}) AS profiles,
      (SELECT count(*)::int FROM wss_wallets WHERE id = ${walletId}) AS wallets
  `;
  if (matchingAddressCount < 2 || remaining.profiles !== 0 || remaining.wallets !== 0) {
    throw new Error('Address-sharing verification failed or fixture did not roll back.');
  }
  console.log(JSON.stringify({ status: 'ok', addressSharing: 'separate-profile-allowed', fixtureCleanup: 'transaction-rolled-back' }));
} finally {
  await sql.end();
}
