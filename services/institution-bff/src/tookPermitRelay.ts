import { ethers } from 'ethers';
import { tookRelayAuthorizationMessage, type TookRelayTransferAuthorization } from '@took-wss/contracts';

// Took Pay Router V2 deployments, from its published service-architecture contract registry.
// The relay verifies the same router again before broadcasting.
const routes = {
  ethereum: { chainId: 1, token: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', router: '0xB75720935f26fAbB42F6143CF272B3cc7C698dc1' },
  polygon: { chainId: 137, token: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', router: '0x9eA2344023224015bA530DF91910dD8bb131aD49' },
  arbitrum: { chainId: 42161, token: '0xaf88d065e77c8cc2239327c5edb3a432268e5831', router: '0x12d990fE3Ce9DF86a44c42A82730007744b52C0F' },
  base: { chainId: 8453, token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', router: '0xCb7ec7538Fd1BF6C5e21b46f661687d4ac5780d1' },
} as const;

export interface TookRelayQuote {
  chainId: number;
  router: string;
  totalAtomic: bigint;
  feeAtomic: bigint;
}

export interface TookRelayPrepareResponse {
  transferId: string;
  serverProof: string;
  chainId: number;
  tokenAddress: string;
  recipient: string;
  spender: string;
  totalAmount: string;
  fee: string;
  recipientReceives: string;
  nonce: string;
  deadline: number;
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
}

export type TookRelayTransfer = TookRelayTransferAuthorization;

export const tookPermitTypes = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
};

export function tookRelayRoute(chainId: string, tokenAddress: string) {
  const route = routes[chainId as keyof typeof routes];
  return route && route.token.toLowerCase() === tokenAddress.toLowerCase() ? route : null;
}

export function tookRelayConfigured(): boolean {
  return Boolean(process.env.WSS_TOOK_TRANSFER_RELAY_URL?.trim() && process.env.WSS_TOOK_TRANSFER_RELAY_ANON_KEY?.trim());
}

export function calculateTookRelayGross(recipientAmount: bigint, feeRate: bigint, minFee: bigint): TookRelayQuote['totalAtomic'] {
  if (recipientAmount <= 0n || feeRate < 0n || feeRate >= 10_000n || minFee < 0n) throw new Error('relay_fee_invalid');
  const feeFor = (amount: bigint) => {
    const proportional = amount * feeRate / 10_000n;
    return proportional > minFee ? proportional : minFee;
  };
  let total = (recipientAmount * 10_000n + (10_000n - feeRate) - 1n) / (10_000n - feeRate);
  if (total < recipientAmount + minFee) total = recipientAmount + minFee;
  while (total - feeFor(total) < recipientAmount) total += 1n;
  while (total > recipientAmount && total - 1n - feeFor(total - 1n) >= recipientAmount) total -= 1n;
  return total;
}

export async function quoteTookRelay(input: {
  chainId: string; tokenAddress: string; recipientAmountAtomic: bigint; rpcUrl: string;
}): Promise<TookRelayQuote | null> {
  const route = tookRelayRoute(input.chainId, input.tokenAddress);
  if (!route || !tookRelayConfigured()) return null;
  try {
    const provider = new ethers.JsonRpcProvider(input.rpcUrl, route.chainId, { staticNetwork: true });
    const router = new ethers.Contract(route.router, [
      'function feeRate() view returns (uint256)',
      'function minFee() view returns (uint256)',
      'function paused() view returns (bool)',
      'function supportedTokens(address) view returns (bool)',
    ], provider);
    const [feeRate, minFee, paused, supported] = await Promise.all([
      router.getFunction('feeRate').staticCall() as Promise<bigint>,
      router.getFunction('minFee').staticCall() as Promise<bigint>,
      router.getFunction('paused').staticCall() as Promise<boolean>,
      router.getFunction('supportedTokens').staticCall(route.token) as Promise<boolean>,
    ]);
    if (paused || !supported) return null;
    const totalAtomic = calculateTookRelayGross(input.recipientAmountAtomic, feeRate, minFee);
    return { chainId: route.chainId, router: route.router, totalAtomic, feeAtomic: totalAtomic - input.recipientAmountAtomic };
  } catch {
    return null;
  }
}

async function relayCall(body: Record<string, unknown>, options?: { statusKey?: string; timeoutMs?: number }): Promise<Record<string, unknown>> {
  const endpoint = process.env.WSS_TOOK_TRANSFER_RELAY_URL?.trim();
  const key = process.env.WSS_TOOK_TRANSFER_RELAY_ANON_KEY?.trim();
  if (!endpoint || !key) throw new Error('relay_unavailable');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options?.timeoutMs ?? 110_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST', signal: controller.signal,
      headers: { 'Content-Type': 'application/json', apikey: key, Authorization: `Bearer ${key}`,
        ...(options?.statusKey ? { 'x-wss-status-key': options.statusKey } : {}) },
      body: JSON.stringify(body),
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(`relay_${response.status}:${String(result.error ?? 'unavailable').slice(0, 150)}`);
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

export interface TookRelayStatus {
  status: 'awaiting_permit' | 'processing' | 'confirmed' | 'failed' | 'expired';
  txHash: string | null;
  confirmedAt: string | null;
}

export async function readTookRelayStatus(transferId: string): Promise<TookRelayStatus | null> {
  const statusKey = process.env.WSS_TOOK_TRANSFER_STATUS_KEY?.trim();
  if (!statusKey) return null;
  try {
    const response = await relayCall({ action: 'status', transferId }, { statusKey, timeoutMs: 10_000 });
    if (response.status !== 'awaiting_permit' && response.status !== 'processing'
      && response.status !== 'confirmed' && response.status !== 'failed' && response.status !== 'expired') {
      throw new Error('relay_status_invalid');
    }
    if (response.txHash !== null && response.txHash !== undefined
      && (typeof response.txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(response.txHash))) {
      throw new Error('relay_status_invalid');
    }
    return {
      status: response.status,
      txHash: typeof response.txHash === 'string' ? response.txHash : null,
      confirmedAt: typeof response.confirmedAt === 'string' && Number.isFinite(Date.parse(response.confirmedAt))
        ? response.confirmedAt : null,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('relay_404:')) return null;
    throw error;
  }
}

function assertWalletAuthorization(transfer: TookRelayTransfer, walletAuthSignature: string): void {
  if (ethers.verifyMessage(tookRelayAuthorizationMessage(transfer), walletAuthSignature).toLowerCase() !== transfer.sender.toLowerCase()) {
    throw new Error('relay_authorization_mismatch');
  }
}

function validatedRelayPreview(response: Record<string, unknown>, transfer: TookRelayTransfer, quote: TookRelayQuote): TookRelayPrepareResponse {
  const prepared = response as unknown as TookRelayPrepareResponse;
  if (prepared.transferId !== transfer.id || prepared.chainId !== transfer.chainId
    || prepared.tokenAddress?.toLowerCase() !== transfer.tokenAddress.toLowerCase()
    || prepared.recipient?.toLowerCase() !== transfer.recipient.toLowerCase()
    || prepared.spender?.toLowerCase() !== quote.router.toLowerCase()
    || prepared.domain?.verifyingContract?.toLowerCase() !== transfer.tokenAddress.toLowerCase()
    || prepared.domain.chainId !== transfer.chainId
    || prepared.domain.name !== 'USD Coin' || prepared.domain.version !== '2'
    || ethers.parseUnits(prepared.totalAmount, 6) !== quote.totalAtomic
    || ethers.parseUnits(prepared.recipientReceives, 6) !== ethers.parseUnits(transfer.tokenAmount, 6)
    || ethers.parseUnits(prepared.fee, 6) !== quote.feeAtomic
    || !/^\d+$/.test(prepared.nonce)
    || !Number.isSafeInteger(prepared.deadline)
    || prepared.deadline !== Math.floor(Date.parse(transfer.expiresAt) / 1000)
    || !prepared.serverProof) throw new Error('relay_quote_changed');
  return prepared;
}

export async function prepareTookRelay(transfer: TookRelayTransfer, walletAuthSignature: string, quote: TookRelayQuote): Promise<TookRelayPrepareResponse> {
  assertWalletAuthorization(transfer, walletAuthSignature);
  const response = await relayCall({ action: 'prepare', transfer, walletAuth: { signature: walletAuthSignature } });
  return validatedRelayPreview(response, transfer, quote);
}

export async function submitTookRelay(input: {
  transfer: TookRelayTransfer;
  quote: TookRelayQuote;
  walletAuthSignature: string;
  permitSignature: string;
}): Promise<string> {
  assertWalletAuthorization(input.transfer, input.walletAuthSignature);
  const response = await relayCall({ action: 'prepare', transfer: input.transfer, walletAuth: { signature: input.walletAuthSignature } });
  if (response.success === true && typeof response.txHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(response.txHash)
    && response.usedRouter === true && typeof response.netAmount === 'string'
    && ethers.parseUnits(response.netAmount, 6) >= ethers.parseUnits(input.transfer.tokenAmount, 6)) {
    return response.txHash;
  }
  const prepared = validatedRelayPreview(response, input.transfer, input.quote);
  const signature = ethers.Signature.from(input.permitSignature);
  const signer = ethers.verifyTypedData(prepared.domain, tookPermitTypes, {
    owner: input.transfer.sender,
    spender: prepared.spender,
    value: input.quote.totalAtomic,
    nonce: BigInt(prepared.nonce),
    deadline: BigInt(prepared.deadline),
  }, signature);
  if (signer.toLowerCase() !== input.transfer.sender.toLowerCase()) throw new Error('relay_permit_signer_mismatch');
  const result = await relayCall({
    action: 'submit', transferId: prepared.transferId, serverProof: prepared.serverProof,
    amount: prepared.totalAmount, deadline: prepared.deadline,
    v: signature.v, r: signature.r, s: signature.s,
  });
  if (result.success !== true || typeof result.txHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result.txHash)
    || result.usedRouter !== true || typeof result.netAmount !== 'string'
    || ethers.parseUnits(result.netAmount, 6) < ethers.parseUnits(input.transfer.tokenAmount, 6)) {
    throw new Error('relay_result_invalid');
  }
  return result.txHash;
}
