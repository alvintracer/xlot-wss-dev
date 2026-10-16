import { createHmac, randomUUID } from 'node:crypto';
import type postgres from 'postgres';
import { RegistrationError } from './phoneRegistration.js';
import type { SupabasePhoneAuthClient } from './supabasePhoneAuth.js';

export function smsPhoneKey(phone: string, secret: string): string {
  if (!/^\+8210\d{8}$/.test(phone) || !secret) {
    throw new RegistrationError('phone_delivery_unavailable');
  }
  return createHmac('sha256', secret)
    .update(`wss-sms-delivery:v1\u0000${phone}`)
    .digest('hex');
}

export async function requestBrandedPhoneOtp(
  sql: ReturnType<typeof postgres>,
  auth: SupabasePhoneAuthClient,
  phone: string,
  brandName: string,
  secret: string,
): Promise<void> {
  if (!/^[\p{L}\p{N} ]{1,40}$/u.test(brandName)) {
    throw new RegistrationError('phone_delivery_unavailable');
  }
  const phoneKey = smsPhoneKey(phone, secret);
  const contextId = randomUUID();
  const inserted = await sql<{ context_id: string }[]>`
    INSERT INTO wss_sms_delivery_contexts (phone_key, context_id, brand_name, expires_at)
    VALUES (${phoneKey}, ${contextId}, ${brandName}, now() + interval '90 seconds')
    ON CONFLICT (phone_key) DO UPDATE
      SET context_id = EXCLUDED.context_id,
          brand_name = EXCLUDED.brand_name,
          expires_at = EXCLUDED.expires_at,
          created_at = now()
      WHERE wss_sms_delivery_contexts.expires_at <= now()
    RETURNING context_id
  `;
  if (!inserted.length) throw new RegistrationError('challenge_rate_limited');
  try {
    await auth.requestOtp(phone);
  } finally {
    // The hook normally consumes the row first. A failed Auth call must not
    // leave it behind, and this id prevents deleting a newer request's row.
    await sql`
      DELETE FROM wss_sms_delivery_contexts
      WHERE phone_key = ${phoneKey} AND context_id = ${contextId}
    `;
  }
}
