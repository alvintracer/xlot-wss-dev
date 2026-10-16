import assert from 'node:assert/strict';
import { verifyAsync } from '@noble/ed25519';
import { Keypair, PublicKey, TransactionInstruction, TransactionMessage, VersionedTransaction } from '@solana/web3.js';

const endpoint = process.env.WSS_TOOK_SOLANA_SPONSOR_URL;
const accessKey = process.env.WSS_TOOK_SOLANA_SPONSOR_KEY;
const anonKey = process.env.WSS_TOOK_SOLANA_SPONSOR_ANON_KEY
  || process.env.WSS_TOOK_INFRA_ANON_KEY || process.env.WSS_TOOK_TRANSFER_RELAY_ANON_KEY;
assert.ok(endpoint && accessKey && anonKey, 'Sponsor endpoint configuration is required.');
const call = async (body) => {
  const response = await fetch(endpoint, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: anonKey,
      Authorization: `Bearer ${anonKey}`, 'x-wss-sponsor-key': accessKey },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(response.status, 200, `Sponsor request failed: ${result.error ?? response.status}`);
  return result;
};
const capabilities = await call({ action: 'capabilities' });
assert.equal(capabilities.version, 1);
const payer = new PublicKey(capabilities.payer);
const owner = Keypair.generate();
const recipient = Keypair.generate().publicKey;
const source = Keypair.generate().publicKey;
const mint = new PublicKey(capabilities.mint);
const tokenProgram = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ataProgram = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const destination = PublicKey.findProgramAddressSync([recipient.toBuffer(), tokenProgram.toBuffer(), mint.toBuffer()], ataProgram)[0];
const data = Buffer.alloc(10);
data[0] = 12;
data.writeBigUInt64LE(1n, 1);
data[9] = 6;
const message = new TransactionMessage({
  payerKey: payer,
  recentBlockhash: PublicKey.default.toBase58(),
  instructions: [new TransactionInstruction({
    programId: tokenProgram,
    keys: [
      { pubkey: source, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: destination, isSigner: false, isWritable: true },
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },
    ], data,
  })],
}).compileToV0Message();
const partial = new VersionedTransaction(message);
partial.sign([owner]);
const result = await call({
  action: 'cosign', transactionBase64: Buffer.from(partial.serialize()).toString('base64'),
  owner: owner.publicKey.toBase58(), recipient: recipient.toBase58(),
  mint: mint.toBase58(), amountAtomic: '1',
});
const completed = VersionedTransaction.deserialize(Buffer.from(result.transactionBase64, 'base64'));
assert.deepEqual(completed.message.serialize(), partial.message.serialize());
assert.deepEqual(completed.signatures[1], partial.signatures[1]);
assert.equal(await verifyAsync(completed.signatures[0], message.serialize(), payer.toBytes()), true);
console.log(JSON.stringify({ payer: payer.toBase58(), cosignVerified: true, broadcast: false }));
