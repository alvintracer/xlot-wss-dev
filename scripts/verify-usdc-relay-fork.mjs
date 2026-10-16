import assert from 'node:assert/strict';
import { ethers } from 'ethers';

// This script only connects to an Anvil fork on loopback. The disposable owner
// key is generated in memory and never leaves the local test process.
const rpcUrl = 'http://127.0.0.1:8546';
const provider = new ethers.JsonRpcProvider(rpcUrl);
async function localReceipt(hash) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const receipt = await provider.send('eth_getTransactionReceipt', [hash]);
      if (receipt) return receipt;
    } catch { /* The public fork RPC can reject a query before Anvil mines it. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Anvil transaction receipt unavailable.');
}
const version = await provider.send('web3_clientVersion', []);
assert.match(version, /anvil/i, 'Run an Anvil Base fork on port 8546 first.');
assert.equal((await provider.getNetwork()).chainId, 8453n);

const tokenAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const routerAddress = '0xCb7ec7538Fd1BF6C5e21b46f661687d4ac5780d1';
const owner = ethers.Wallet.createRandom().connect(provider);
const recipientAddress = '0x2222222222222222222222222222222222222222';
const relayerAddress = '0x9999999999999999999999999999999999999999';
const tokenInterface = new ethers.Interface([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'function transfer(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function nonces(address) view returns (uint256)',
]);
const token = new ethers.Contract(tokenAddress, tokenInterface, provider);
const router = new ethers.Contract(routerAddress, [
  'function feeRate() view returns (uint256)',
  'function minFee() view returns (uint256)',
  'function treasury() view returns (address)',
  'function supportedTokens(address) view returns (bool)',
  'function permitTransferWithFee(address,address,address,uint256,uint256,uint256,uint8,bytes32,bytes32)',
  'event PermitTransferWithFee(address indexed token,address indexed from,address indexed to,uint256 amount,uint256 fee,uint256 minReceive)',
], provider);
assert.equal(await router.supportedTokens(tokenAddress), true);

const recipientAmount = 1_000_000n;
const feeRate = await router.feeRate();
const minFee = await router.minFee();
const feeFor = (amount) => {
  const proportional = amount * feeRate / 10_000n;
  return proportional > minFee ? proportional : minFee;
};
let gross = recipientAmount + minFee;
while (gross - feeFor(gross) < recipientAmount) gross += 1n;

const height = await provider.getBlockNumber();
const logs = await provider.getLogs({
  address: tokenAddress, fromBlock: height - 30, toBlock: height,
  topics: [tokenInterface.getEvent('Transfer').topicHash],
});
const candidates = [...new Set(logs.map((log) => tokenInterface.parseLog(log)?.args.to).filter(Boolean))].slice(0, 100);
const balances = await Promise.all(candidates.map(async (address) => ({ address, balance: await token.balanceOf(address) })));
const holder = balances.find(({ balance }) => balance > gross * 5n);
assert.ok(holder, 'No USDC holder found in recent fork blocks.');
await provider.send('anvil_impersonateAccount', [holder.address]);
await provider.send('anvil_impersonateAccount', [relayerAddress]);
await provider.send('anvil_setBalance', [holder.address, ethers.toBeHex(ethers.parseEther('1'))]);
await provider.send('anvil_setBalance', [relayerAddress, ethers.toBeHex(ethers.parseEther('1'))]);
const funding = await token.connect(await provider.getSigner(holder.address)).transfer(owner.address, gross);
assert.equal(Number((await localReceipt(funding.hash)).status), 1);
await provider.send('anvil_setBalance', [owner.address, '0x0']);
assert.equal(await provider.getBalance(owner.address), 0n);

const treasuryAddress = await router.treasury();
const [ownerBefore, recipientBefore, treasuryBefore, nonce] = await Promise.all([
  token.balanceOf(owner.address), token.balanceOf(recipientAddress), token.balanceOf(treasuryAddress), token.nonces(owner.address),
]);
const deadline = BigInt(Math.floor(Date.now() / 1_000) + 600);
const permitSignature = ethers.Signature.from(await owner.signTypedData({
  name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: tokenAddress,
}, {
  Permit: [
    { name: 'owner', type: 'address' }, { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' }, { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}, { owner: owner.address, spender: routerAddress, value: gross, nonce, deadline }));
const transaction = await router.connect(await provider.getSigner(relayerAddress)).permitTransferWithFee(
  tokenAddress, owner.address, recipientAddress, gross, recipientAmount, deadline,
  permitSignature.v, permitSignature.r, permitSignature.s,
  { gasLimit: 700_000 },
);
const receipt = await localReceipt(transaction.hash);
assert.equal(Number(receipt.status), 1);
const [ownerAfter, recipientAfter, treasuryAfter] = await Promise.all([
  token.balanceOf(owner.address), token.balanceOf(recipientAddress), token.balanceOf(treasuryAddress),
]);
assert.equal(ownerBefore - ownerAfter, gross);
assert.equal(recipientAfter - recipientBefore, gross - feeFor(gross));
assert.equal(treasuryAfter - treasuryBefore, feeFor(gross));
assert.equal(await provider.getBalance(owner.address), 0n);
console.log(JSON.stringify({
  network: 'Base mainnet fork', recipientAtomic: (recipientAfter - recipientBefore).toString(),
  feeAtomic: (treasuryAfter - treasuryBefore).toString(),
  customerNativeBalanceAtomic: '0', transactionHash: transaction.hash,
}));
