import type { PrepareTransferRequest, TenantManifest, WssSessionClaims } from '@took-wss/contracts';
import type { WalletQueryProvider } from '@took-wss/provider-adapters';

type Session = Omit<WssSessionClaims, 'nonce'>;

const evmChains = new Set(['ethereum', 'polygon', 'arbitrum', 'base', 'bnb']);

export async function assertOwnedWalletAddress(input: {
  provider: WalletQueryProvider;
  session: Session;
  manifest: TenantManifest;
  walletId: string;
  chainId: PrepareTransferRequest['chainId'];
  recipient: string;
}): Promise<string> {
  const address = await input.provider.getOwnedReceiveAddress({
    session: input.session, manifest: input.manifest, walletId: input.walletId, chainId: input.chainId,
  });
  if (!address || (evmChains.has(input.chainId)
    ? address.toLowerCase() !== input.recipient.toLowerCase()
    : address !== input.recipient)) throw new Error('own_wallet_destination_invalid');
  return address;
}

export async function verifyOwnedWalletDestination(input: {
  provider: WalletQueryProvider;
  session: Session;
  manifest: TenantManifest;
  request: PrepareTransferRequest;
}): Promise<{ walletId: string; address: string } | null> {
  const { provider, session, manifest, request } = input;
  const destinationWalletId = request.destinationWalletId;
  if (!destinationWalletId) return null;
  if (request.channel !== 'address' || request.walletId === destinationWalletId
    || request.destinationTag !== undefined || request.complianceReason !== undefined) {
    throw new Error('own_wallet_destination_invalid');
  }
  const address = await assertOwnedWalletAddress({
    provider, session, manifest, walletId: destinationWalletId,
    chainId: request.chainId, recipient: request.recipient,
  });
  return { walletId: destinationWalletId, address };
}
