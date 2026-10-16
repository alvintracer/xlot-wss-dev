import assert from 'node:assert/strict';
import { ethers } from 'ethers';
import type { DexQuoteProvider } from '@took-wss/provider-adapters';
import type { ReadyWalletHomePayload, WssSessionClaims } from '@took-wss/contracts';
import { getExchangeStatus, prepareExchange, requestExchangeQuote, submitExchange } from '../services/institution-bff/src/exchangeService.ts';

const rpcUrl = 'http://127.0.0.1:8546';
assert.equal(process.env.WSS_BASE_RPC_URL, rpcUrl);
assert.equal(process.env.VITEST, '1');
const rpc = new ethers.JsonRpcProvider(rpcUrl);
assert.match(await rpc.send('web3_clientVersion', []), /anvil/i);
assert.equal((await rpc.getNetwork()).chainId, 8453n);

const owner = ethers.Wallet.createRandom().connect(rpc);
await rpc.send('anvil_setBalance', [owner.address, ethers.toBeHex(ethers.parseEther('0.1'))]);
const tokenAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const token = new ethers.Contract(tokenAddress, [
  'function allowance(address,address) view returns (uint256)',
], rpc);
const spender = '0x0000000000000000000000000000000000000099';
const assetId = `base:evm-erc20:${tokenAddress}`;
const walletId = '11111111-1111-4111-8111-111111111111';
const session: Omit<WssSessionClaims, 'nonce'> = {
  protocolVersion: 1, sessionId: 'fork-exchange', tenantId: 'kiwoom', subject: 'fork-subject',
  subjectVersion: 1, keyAdapter: 'took-sar', issuedAt: 1, expiresAt: 9_999_999_999,
};
const home: ReadyWalletHomePayload = {
  status: 'ready',
  wallet: { walletId, label: 'Fork wallet', keyAdapter: 'took-sar', origin: 'created' },
  wallets: [{ walletId, label: 'Fork wallet', keyAdapter: 'took-sar', origin: 'created' }],
  assets: [],
  receiveAssets: [
    { assetId, iconAssetId: 'coin:usdc', chainId: 'base', addressGroupId: 'evm', symbol: 'USDC', name: 'USD Coin', network: 'Base', decimals: 6,
      tokenAddress, canonical: true, balanceStatus: 'ready', balanceAtomic: '1000000', balanceDisplay: '1', availableAtomic: '1000000', transferStatus: 'enabled' },
    { assetId: 'base:native', iconAssetId: 'coin:eth', chainId: 'base', addressGroupId: 'evm', symbol: 'ETH', name: 'Ethereum', network: 'Base', decimals: 18,
      canonical: true, balanceStatus: 'ready', balanceAtomic: ethers.parseEther('0.1').toString(), balanceDisplay: '0.1', availableAtomic: ethers.parseEther('0.1').toString(), transferStatus: 'enabled' },
  ],
  networks: [{ chainId: 'base', addressGroupId: 'evm', network: 'Base', nativeSymbol: 'ETH', status: 'registered', addressStatus: 'ready', address: owner.address }],
  valuation: { currency: 'KRW', provider: 'fork', status: 'unavailable', asOf: new Date().toISOString() },
  recovery: { profile: 'sar-2-of-3', status: 'ready', policyVersion: 1 },
  source: 'wallet-query',
};
const quoteProvider: DexQuoteProvider = {
  id: 'fork-quote',
  async getFirmQuote() {
    const allowance = await token.allowance(owner.address, spender) as bigint;
    return {
      providerQuoteId: ethers.id(String(Date.now())),
      sellAmountAtomic: '1000000', buyAmountAtomic: '100000000000000',
      allowanceTarget: spender, allowanceRequired: allowance < 1_000_000n,
      liquidityAvailable: true, networkFeeAtomic: '100000000000000',
      transaction: { to: spender, data: '0x1234', value: '0', gas: '100000', gasPrice: '1000000000' },
    };
  },
};
const request = { walletId, chainId: 'base', sellAssetId: assetId, buyAssetId: 'base:native', mode: 'exact-in' as const, amountAtomic: '1000000' };
const firstQuote = await requestExchangeQuote({ session, home, request, provider: quoteProvider });
assert.equal(firstQuote.allowanceRequired, true);
const approval = await prepareExchange({ session, request: { quoteId: firstQuote.quoteId } });
assert.equal(approval.stage, 'allowance');
assert.equal(approval.signingRequest.transaction.type, 'evm-erc20');
if (approval.signingRequest.transaction.type !== 'evm-erc20') throw new Error('Missing ERC-20 approval');
const payload = approval.signingRequest.transaction;
assert.equal(payload.purpose, 'token-approval');
assert.equal(payload.to.toLowerCase(), tokenAddress);
const signedTransaction = await owner.signTransaction({
  chainId: payload.chainId, nonce: payload.nonce, to: payload.to, value: BigInt(payload.value),
  gasLimit: BigInt(payload.gasLimit), gasPrice: BigInt(payload.gasPrice), data: payload.data,
});
const result = await submitExchange({ session, authorizationId: 'fork-host-authorization', request: {
  intentId: approval.intentId, signedTransaction, hostAuthorizationProof: 'fork-only', idempotencyKey: 'fork-approval',
} });
assert.equal(result.status, 'submitted');
await rpc.waitForTransaction(result.transactionHash, 1, 15_000);
const status = await getExchangeStatus({ session, intentId: approval.intentId });
assert.equal(status.status, 'allowance-confirmed');
assert.equal(await token.allowance(owner.address, spender), 1_000_000n);
const secondQuote = await requestExchangeQuote({ session, home, request, provider: quoteProvider });
assert.equal(secondQuote.allowanceRequired, false);
const swap = await prepareExchange({ session, request: { quoteId: secondQuote.quoteId } });
assert.equal(swap.stage, 'swap');
assert.equal(swap.signingRequest.transaction.type, 'evm-erc20');
if (swap.signingRequest.transaction.type !== 'evm-erc20') throw new Error('Missing swap');
assert.equal(swap.signingRequest.transaction.purpose, 'asset-swap');
console.log(JSON.stringify({ network: 'Base mainnet fork', approvalStatus: status.status, freshStage: swap.stage }));
