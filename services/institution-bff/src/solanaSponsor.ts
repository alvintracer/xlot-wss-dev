import { PublicKey } from '@solana/web3.js';

const CANONICAL_USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export function solanaSponsorConfigured(): boolean {
  return process.env.WSS_SOLANA_SPONSOR_ENABLED === 'true'
    && Boolean(process.env.WSS_TOOK_SOLANA_SPONSOR_URL?.trim()
      && process.env.WSS_TOOK_SOLANA_SPONSOR_KEY?.trim()
      && (process.env.WSS_TOOK_SOLANA_SPONSOR_ANON_KEY?.trim()
        || process.env.WSS_TOOK_INFRA_ANON_KEY?.trim()
        || process.env.WSS_TOOK_TRANSFER_RELAY_ANON_KEY?.trim()));
}

async function sponsorCall(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const endpoint = process.env.WSS_TOOK_SOLANA_SPONSOR_URL?.trim();
  const accessKey = process.env.WSS_TOOK_SOLANA_SPONSOR_KEY?.trim();
  const anonKey = process.env.WSS_TOOK_SOLANA_SPONSOR_ANON_KEY?.trim()
    || process.env.WSS_TOOK_INFRA_ANON_KEY?.trim()
    || process.env.WSS_TOOK_TRANSFER_RELAY_ANON_KEY?.trim();
  if (!endpoint || !accessKey || !anonKey) throw new Error('solana_sponsor_unavailable');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', apikey: anonKey,
        Authorization: `Bearer ${anonKey}`, 'x-wss-sponsor-key': accessKey },
      body: JSON.stringify(body),
    });
    const value = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error('solana_sponsor_unavailable');
    return value;
  } finally {
    clearTimeout(timer);
  }
}

export async function solanaSponsorFeePayer(): Promise<string | null> {
  if (!solanaSponsorConfigured()) return null;
  try {
    const response = await sponsorCall({ action: 'capabilities' });
    if (response.version !== 1 || response.mint !== CANONICAL_USDC_MINT || typeof response.payer !== 'string') {
      throw new Error('solana_sponsor_invalid');
    }
    return new PublicKey(response.payer).toBase58();
  } catch {
    return null;
  }
}

export async function cosignSponsoredSolana(input: {
  transactionBase64: string;
  owner: string;
  recipient: string;
  mint: string;
  amountAtomic: string;
  expectedPayer: string;
}): Promise<string> {
  if (!solanaSponsorConfigured() || input.mint !== CANONICAL_USDC_MINT) throw new Error('solana_sponsor_unavailable');
  const response = await sponsorCall({ action: 'cosign', transactionBase64: input.transactionBase64,
    owner: input.owner, recipient: input.recipient, mint: input.mint, amountAtomic: input.amountAtomic });
  if (response.version !== 1 || response.payer !== input.expectedPayer
    || typeof response.transactionBase64 !== 'string' || response.transactionBase64.length > 16_384) {
    throw new Error('solana_sponsor_result_invalid');
  }
  return response.transactionBase64;
}
