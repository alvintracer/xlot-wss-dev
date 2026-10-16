import { createThirdwebClient } from 'thirdweb';
import { inAppWallet } from 'thirdweb/wallets';
import type { Account } from 'thirdweb/wallets';
import type { EvmTransactionSigningPayload, TookRelayTransferAuthorization } from '@took-wss/contracts';
import { tookRelayAuthorizationMessage } from '@took-wss/contracts';

const connected = new Map<string, Account>();

function client(clientId: string) {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(clientId)) throw new Error('thirdweb_not_configured');
  return createThirdwebClient({ clientId });
}

export function rememberConnectedThirdwebAccount(clientId: string, account: Account): void {
  client(clientId);
  if (!/^0x[0-9a-fA-F]{40}$/.test(account.address)) throw new Error('thirdweb_auth_failed');
  connected.set(clientId, account);
}

export async function connectedThirdwebAccount(clientId: string): Promise<Account | null> {
  const existing = connected.get(clientId);
  if (existing) return existing;
  try {
    const wallet = inAppWallet({ hidePrivateKeyExport: true });
    const account = await wallet.autoConnect({ client: client(clientId) });
    connected.set(clientId, account);
    return account;
  } catch { return null; }
}

export async function signThirdwebConnectionChallenge(clientId: string, address: string, message: string): Promise<string> {
  const account = await connectedThirdwebAccount(clientId);
  if (!account || account.address.toLowerCase() !== address.toLowerCase()) throw new Error('thirdweb_auth_failed');
  return account.signMessage({ message });
}

export async function signThirdwebEvmTransaction(account: Account, transaction: EvmTransactionSigningPayload): Promise<string> {
  if (!account.signTransaction) throw new Error('thirdweb_raw_signing_unavailable');
  return account.signTransaction({
    type: 'legacy',
    chainId: transaction.chainId,
    nonce: transaction.nonce,
    to: transaction.to,
    value: BigInt(transaction.value),
    gas: BigInt(transaction.gasLimit),
    gasPrice: BigInt(transaction.gasPrice),
    data: (transaction.data ?? '0x') as `0x${string}`,
  });
}

export async function signThirdwebRelayAuthorization(account: Account, transfer: TookRelayTransferAuthorization): Promise<string> {
  return account.signMessage({ message: tookRelayAuthorizationMessage(transfer) });
}

export async function signThirdwebUsdcPermit(account: Account, input: {
  domain: { name: string; version: string; chainId: number; verifyingContract: string };
  spender: string;
  value: string;
  nonce: string;
  deadline: number;
}): Promise<string> {
  return account.signTypedData({
    domain: input.domain,
    types: {
      Permit: [
        { name: 'owner', type: 'address' },
        { name: 'spender', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'nonce', type: 'uint256' },
        { name: 'deadline', type: 'uint256' },
      ],
    },
    primaryType: 'Permit',
    message: {
      owner: account.address,
      spender: input.spender,
      value: BigInt(input.value),
      nonce: BigInt(input.nonce),
      deadline: BigInt(input.deadline),
    },
  } as Parameters<Account['signTypedData']>[0]);
}
