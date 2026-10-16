import { afterEach, describe, expect, it, vi } from 'vitest';
import { ethers } from 'ethers';
import { tookRelayAuthorizationMessage } from '@took-wss/contracts';
import { calculateTookRelayGross, prepareTookRelay, submitTookRelay, tookPermitTypes } from './tookPermitRelay';

const originalUrl = process.env.WSS_TOOK_TRANSFER_RELAY_URL;
const originalKey = process.env.WSS_TOOK_TRANSFER_RELAY_ANON_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalUrl === undefined) delete process.env.WSS_TOOK_TRANSFER_RELAY_URL;
  else process.env.WSS_TOOK_TRANSFER_RELAY_URL = originalUrl;
  if (originalKey === undefined) delete process.env.WSS_TOOK_TRANSFER_RELAY_ANON_KEY;
  else process.env.WSS_TOOK_TRANSFER_RELAY_ANON_KEY = originalKey;
});

describe('Took Permit Router V2 adapter', () => {
  it('grosses up the sender debit so the requested recipient amount survives the router fee', () => {
    expect(calculateTookRelayGross(1_000_000n, 20n, 50_000n)).toBe(1_050_000n);
    expect(calculateTookRelayGross(100_000_000n, 20n, 50_000n)).toBe(100_200_400n);
  });

  it('rejects changed relay terms before Permit signing and submits only a matching signature', async () => {
    process.env.WSS_TOOK_TRANSFER_RELAY_URL = 'https://relay.example.test/functions/v1/took-pay-transfer-relay';
    process.env.WSS_TOOK_TRANSFER_RELAY_ANON_KEY = 'public-test-key';
    const wallet = ethers.Wallet.createRandom();
    const recipient = '0x0000000000000000000000000000000000000002';
    const token = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
    const router = '0xB75720935f26fAbB42F6143CF272B3cc7C698dc1';
    const transfer = {
      id: 'tr_12345678-1234-1234-1234-123456789012', sender: wallet.address,
      recipient, chainKey: 'ethereum' as const, chainId: 1, tokenAddress: token,
      tokenAmount: '1.0', expiresAt: new Date(Date.now() + 120_000).toISOString(),
    };
    const quote = { chainId: 1, router, totalAtomic: 1_050_000n, feeAtomic: 50_000n };
    const preview = {
      transferId: transfer.id, serverProof: 'server-proof', chainId: 1, tokenAddress: token,
      recipient, spender: router, totalAmount: '1.05', fee: '0.05', recipientReceives: '1.0',
      nonce: '3', deadline: Math.floor(Date.parse(transfer.expiresAt) / 1000),
      domain: { name: 'USD Coin', version: '2', chainId: 1, verifyingContract: token },
    };
    const calls: Array<Record<string, unknown>> = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push(body);
      return new Response(JSON.stringify(body.action === 'submit'
        ? { success: true, txHash: `0x${'a'.repeat(64)}`, netAmount: '1.0', usedRouter: true }
        : preview), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));
    const walletAuthSignature = await wallet.signMessage(tookRelayAuthorizationMessage(transfer));
    await expect(prepareTookRelay(transfer, walletAuthSignature, quote)).resolves.toMatchObject({ transferId: transfer.id, spender: router });
    await expect(prepareTookRelay(transfer, walletAuthSignature, { ...quote, feeAtomic: 40_000n }))
      .rejects.toThrow('relay_quote_changed');
    const permitSignature = await wallet.signTypedData(preview.domain, tookPermitTypes, {
      owner: wallet.address, spender: router, value: quote.totalAtomic, nonce: 3n, deadline: BigInt(preview.deadline),
    });
    await expect(submitTookRelay({ transfer, quote, walletAuthSignature, permitSignature }))
      .resolves.toBe(`0x${'a'.repeat(64)}`);
    expect(calls.at(-1)).toMatchObject({ action: 'submit', amount: '1.05', transferId: transfer.id });
    await expect(submitTookRelay({ transfer, quote, walletAuthSignature, permitSignature: await ethers.Wallet.createRandom()
      .signTypedData(preview.domain, tookPermitTypes, {
        owner: wallet.address, spender: router, value: quote.totalAtomic, nonce: 3n, deadline: BigInt(preview.deadline),
      }) })).rejects.toThrow('relay_permit_signer_mismatch');
  });
});
