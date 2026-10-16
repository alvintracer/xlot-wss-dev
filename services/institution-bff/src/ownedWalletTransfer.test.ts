import { describe, expect, it, vi } from 'vitest';
import type { PrepareTransferRequest, TenantManifest, WssSessionClaims } from '@took-wss/contracts';
import type { WalletQueryProvider } from '@took-wss/provider-adapters';
import { assertOwnedWalletAddress, verifyOwnedWalletDestination } from './ownedWalletTransfer';

const recipient = '0x00000000000000000000000000000000000000ab';
const session = { tenantId: 'namu', sessionId: 'session-1' } as Omit<WssSessionClaims, 'nonce'>;
const manifest = { tenantId: 'namu', chains: ['base'] } as TenantManifest;
const request: PrepareTransferRequest = {
  walletId: 'source-wallet', assetId: 'base:native', chainId: 'base', recipient,
  amountAtomic: '100', channel: 'address', destinationWalletId: 'destination-wallet',
};

describe('owned wallet destination verification', () => {
  it('uses the current institution session to verify the destination address', async () => {
    const storedAddress = '0x00000000000000000000000000000000000000AB';
    const getOwnedReceiveAddress = vi.fn(async () => storedAddress);
    const provider = { getOwnedReceiveAddress } as unknown as WalletQueryProvider;
    expect(await verifyOwnedWalletDestination({ provider, session, manifest, request }))
      .toEqual({ walletId: 'destination-wallet', address: storedAddress });
    expect(getOwnedReceiveAddress).toHaveBeenCalledWith({ session, manifest,
      walletId: 'destination-wallet', chainId: 'base' });
  });

  it('rejects a different address or a non-owned destination', async () => {
    const provider = { getOwnedReceiveAddress: vi.fn(async () => null) } as unknown as WalletQueryProvider;
    await expect(verifyOwnedWalletDestination({ provider, session, manifest, request }))
      .rejects.toThrow('own_wallet_destination_invalid');
    const wrongAddressProvider = { getOwnedReceiveAddress: vi.fn(async () => '0x0000000000000000000000000000000000000002') } as unknown as WalletQueryProvider;
    await expect(verifyOwnedWalletDestination({ provider: wrongAddressProvider, session, manifest, request }))
      .rejects.toThrow('own_wallet_destination_invalid');
  });

  it('rejects a destination removed after preparation when checked again at submission', async () => {
    const getOwnedReceiveAddress = vi.fn()
      .mockResolvedValueOnce(recipient)
      .mockResolvedValueOnce(null);
    const provider = { getOwnedReceiveAddress } as unknown as WalletQueryProvider;
    await expect(verifyOwnedWalletDestination({ provider, session, manifest, request }))
      .resolves.toMatchObject({ walletId: request.destinationWalletId });
    await expect(assertOwnedWalletAddress({
      provider, session, manifest, walletId: request.destinationWalletId!,
      chainId: request.chainId, recipient,
    })).rejects.toThrow('own_wallet_destination_invalid');
  });

  it('rejects self, phone, and tagged transfers before querying the destination', async () => {
    const getOwnedReceiveAddress = vi.fn(async () => recipient);
    const provider = { getOwnedReceiveAddress } as unknown as WalletQueryProvider;
    for (const change of [
      { destinationWalletId: request.walletId },
      { channel: 'phone' as const },
      { destinationTag: '123' },
    ]) {
      await expect(verifyOwnedWalletDestination({ provider, session, manifest, request: { ...request, ...change } }))
        .rejects.toThrow('own_wallet_destination_invalid');
    }
    expect(getOwnedReceiveAddress).not.toHaveBeenCalled();
  });
});
