import assert from 'node:assert/strict';
import { ethers } from 'ethers';

const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8546');
assert.match(await provider.send('web3_clientVersion', []), /anvil/i);
assert.equal((await provider.getNetwork()).chainId, 8453n);
const tokenAddress = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const escrowAddress = '0xA119D5128480B3084356ed665c2B936ee0032Ef3';
const tokenInterface = new ethers.Interface([
  'event Transfer(address indexed from,address indexed to,uint256 value)',
  'function transfer(address,uint256) returns(bool)',
  'function approve(address,uint256) returns(bool)',
  'function balanceOf(address) view returns(uint256)',
]);
const token = new ethers.Contract(tokenAddress, tokenInterface, provider);
const escrow = new ethers.Contract(escrowAddress, [
  'function deposit(bytes32,address,uint256,uint64) payable',
  'function refund(bytes32)',
  'function deposits(bytes32) view returns(address sender,address token,uint256 amount,uint64 expiry,bool isClaimed)',
  'event Deposited(bytes32 indexed commitment,address indexed sender,uint256 amount,address token)',
  'event Refunded(bytes32 indexed commitment,address indexed sender)',
], provider);
async function receipt(hash) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const value = await provider.send('eth_getTransactionReceipt', [hash]);
      if (value) return value;
    } catch { /* Public fork upstream can reject receipt lookup before local mining. */ }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('Anvil receipt unavailable.');
}
const owner = ethers.Wallet.createRandom().connect(provider);
const commitment = ethers.hexlify(ethers.randomBytes(32));
const amount = 1_000_000n;
const height = await provider.getBlockNumber();
const logs = await provider.getLogs({
  address: tokenAddress, fromBlock: height - 30, toBlock: height,
  topics: [tokenInterface.getEvent('Transfer').topicHash],
});
const candidates = [...new Set(logs.map((log) => tokenInterface.parseLog(log)?.args.to).filter(Boolean))].slice(0, 100);
const balances = await Promise.all(candidates.map(async (address) => ({ address, balance: await token.balanceOf(address) })));
const holder = balances.find(({ balance }) => balance > 5n * amount);
assert.ok(holder);
await provider.send('anvil_impersonateAccount', [holder.address]);
await provider.send('anvil_setBalance', [holder.address, ethers.toBeHex(ethers.parseEther('1'))]);
await provider.send('anvil_setBalance', [owner.address, ethers.toBeHex(ethers.parseEther('0.1'))]);
const funding = await token.connect(await provider.getSigner(holder.address)).transfer(owner.address, amount);
assert.equal(Number((await receipt(funding.hash)).status), 1);
const approval = await token.connect(owner).approve(escrowAddress, amount);
assert.equal(Number((await receipt(approval.hash)).status), 1);
const block = await provider.getBlock('latest');
assert.ok(block);
const expiry = block.timestamp + 120;
const deposit = await escrow.connect(owner).deposit(commitment, tokenAddress, amount, expiry);
const depositReceipt = await receipt(deposit.hash);
assert.equal(Number(depositReceipt.status), 1);
const saved = await escrow.deposits(commitment);
assert.equal(saved.sender.toLowerCase(), owner.address.toLowerCase());
assert.equal(saved.token.toLowerCase(), tokenAddress.toLowerCase());
assert.equal(saved.amount, amount);
assert.equal(saved.expiry, BigInt(expiry));
assert.equal(await token.balanceOf(owner.address), 0n);
await provider.send('evm_increaseTime', [121]);
await provider.send('evm_mine', []);
const refund = await escrow.connect(owner).refund(commitment);
assert.equal(Number((await receipt(refund.hash)).status), 1);
assert.equal(await token.balanceOf(owner.address), amount);
assert.equal((await escrow.deposits(commitment)).sender, ethers.ZeroAddress);
console.log(JSON.stringify({ network: 'Base mainnet fork', depositVerified: true,
  refundVerified: true, customerRecoveredAtomic: amount.toString(), broadcast: false }));
