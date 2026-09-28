import { describe, expect, it } from 'vitest';
import { verifyAsync } from '@noble/ed25519';
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ethers } from 'ethers';
import { decode } from 'xrpl';
import { ReferenceHostSarKeyCore } from './index';

describe('reference host SAR key core', () => {
  it('creates distinct real multichain addresses without returning secret material', async () => {
    const core = new ReferenceHostSarKeyCore();
    const first = await core.createWallet();
    const second = await core.createWallet();

    expect(first.addresses.map(({ addressGroupId }) => addressGroupId)).toEqual(['evm', 'solana', 'bitcoin', 'tron', 'xrp']);
    expect(first.addresses.find(({ addressGroupId }) => addressGroupId === 'evm')?.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(first.addresses.find(({ addressGroupId }) => addressGroupId === 'bitcoin')?.address).toMatch(/^1[1-9A-HJ-NP-Za-km-z]{25,34}$/);
    expect(first.addresses.find(({ addressGroupId }) => addressGroupId === 'tron')?.address).toMatch(/^T[1-9A-HJ-NP-Za-km-z]{33}$/);
    expect(first.addresses.find(({ addressGroupId }) => addressGroupId === 'xrp')?.address).toMatch(/^r[1-9A-HJ-NP-Za-km-z]{24,34}$/);
    expect(second.addresses).not.toEqual(first.addresses);
    expect(first.recoveryEnvelopes).toHaveLength(3);
    expect(new Set(first.recoveryEnvelopes.map(({ factorIndex }) => factorIndex))).toEqual(new Set([1, 2, 3]));
    expect(first.recoveryEnvelopes.every(({ ciphertextBase64 }) => ciphertextBase64.length >= 24)).toBe(true);
    expect(JSON.stringify(first)).not.toMatch(/mnemonic|privateKey|seedPhrase|recoveryShare|entropy|\bshare\b/i);
  });

  it('reconstructs the wallet through every valid two-of-three share pair', async () => {
    const core = new ReferenceHostSarKeyCore();
    const wallet = await core.createWallet();

    await expect(core.verifyRecovery(wallet.keyHandle, [0, 1])).resolves.toBe(true);
    await expect(core.verifyRecovery(wallet.keyHandle, [0, 2])).resolves.toBe(true);
    await expect(core.verifyRecovery(wallet.keyHandle, [1, 2])).resolves.toBe(true);
    await expect(core.verifyRecovery(wallet.keyHandle, [1, 1])).resolves.toBe(false);
  });

  it('prepares a real 12-word BIP-39 backup and can discard the uncommitted wallet', async () => {
    const core = new ReferenceHostSarKeyCore();
    const prepared = await core.prepareWallet();

    expect(prepared.mnemonicWords).toHaveLength(12);
    expect(ethers.Mnemonic.isValidMnemonic(prepared.mnemonicWords.join(' '))).toBe(true);
    expect(JSON.stringify(prepared.wallet)).not.toContain(prepared.mnemonicWords.join(' '));
    await expect(core.verifyRecovery(prepared.wallet.keyHandle, [0, 1])).resolves.toBe(true);

    await core.discardWallet(prepared.wallet.keyHandle);
    await expect(core.verifyRecovery(prepared.wallet.keyHandle, [0, 1])).resolves.toBe(false);
  });

  it('imports a BIP-39 mnemonic into a real multichain SAR wallet and signs from it', async () => {
    const core = new ReferenceHostSarKeyCore();
    const mnemonic = ethers.Wallet.createRandom().mnemonic!.phrase;
    const wallet = await core.prepareImportedMnemonic(`  ${mnemonic.replaceAll(' ', '  ')}  `);
    const from = wallet.addresses.find(({ addressGroupId }) => addressGroupId === 'evm')!.address;
    const expected = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/0").address;

    expect(wallet.addresses.map(({ addressGroupId }) => addressGroupId)).toEqual(['evm', 'solana', 'bitcoin', 'tron', 'xrp']);
    expect(from).toBe(expected);
    expect(JSON.stringify(wallet)).not.toContain(mnemonic);
    await expect(core.verifyRecovery(wallet.keyHandle, [0, 2])).resolves.toBe(true);

    const signed = await core.signEvmTransactionForAddress(from, {
      chainId: 1,
      nonce: 0,
      to: '0x0000000000000000000000000000000000000001',
      value: '1',
      gasLimit: '21000',
      gasPrice: '1',
    });
    expect(ethers.Transaction.from(signed).from).toBe(from);
  });

  it('imports an EVM private key as an EVM-only SAR wallet and signs from it', async () => {
    const core = new ReferenceHostSarKeyCore();
    const privateKey = ethers.Wallet.createRandom().privateKey;
    const expected = new ethers.Wallet(privateKey).address;
    const wallet = await core.prepareImportedEvmPrivateKey(privateKey.slice(2));

    expect(wallet.addresses).toEqual([{ addressGroupId: 'evm', address: expected }]);
    expect(JSON.stringify(wallet)).not.toContain(privateKey.slice(2));
    await expect(core.verifyRecovery(wallet.keyHandle, [1, 2])).resolves.toBe(true);
    const signed = await core.signEvmTransactionForAddress(expected, {
      chainId: 137,
      nonce: 2,
      to: '0x0000000000000000000000000000000000000001',
      value: '10',
      gasLimit: '21000',
      gasPrice: '2',
    });
    expect(ethers.Transaction.from(signed).from).toBe(expected);
    await expect(core.signSolanaTransactionForAddress(expected, 'invalid')).rejects.toThrow();
  });

  it('rejects invalid wallet import material before a key handle is registered', async () => {
    const core = new ReferenceHostSarKeyCore();
    await expect(core.prepareImportedMnemonic('not a valid recovery phrase')).rejects.toThrow('invalid_mnemonic');
    await expect(core.prepareImportedEvmPrivateKey('0x1234')).rejects.toThrow('invalid_private_key');
  });

  it('reconstructs the EVM signer only inside the key core and signs the exact native transaction', async () => {
    const core = new ReferenceHostSarKeyCore();
    const wallet = await core.createWallet();
    const from = wallet.addresses.find(({ addressGroupId }) => addressGroupId === 'evm')!.address;
    const signed = await core.signEvmNativeTransactionForAddress(from, {
      chainId: 1,
      nonce: 3,
      to: '0x0000000000000000000000000000000000000001',
      value: '1000000000000000',
      gasLimit: '21000',
      gasPrice: '20000000000',
    });
    const transaction = ethers.Transaction.from(signed);

    expect(transaction.from).toBe(from);
    expect(transaction.to).toBe('0x0000000000000000000000000000000000000001');
    expect(transaction.value).toBe(1_000_000_000_000_000n);
    expect(transaction.chainId).toBe(1n);
    expect(JSON.stringify({ signed })).not.toMatch(/mnemonic|privateKey|seedPhrase|recoveryShare|entropy/i);
  });

  it('signs an ERC-20 transfer calldata without exposing key material', async () => {
    const core = new ReferenceHostSarKeyCore();
    const wallet = await core.createWallet();
    const from = wallet.addresses.find(({ addressGroupId }) => addressGroupId === 'evm')!.address;
    const token = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
    const recipient = '0x0000000000000000000000000000000000000001';
    const data = new ethers.Interface(['function transfer(address to, uint256 amount)'])
      .encodeFunctionData('transfer', [recipient, 1_000_000n]);
    const signed = await core.signEvmTransactionForAddress(from, {
      chainId: 1,
      nonce: 4,
      to: token,
      value: '0',
      gasLimit: '65000',
      gasPrice: '20000000000',
      data,
    });
    const transaction = ethers.Transaction.from(signed);

    expect(transaction.from).toBe(from);
    expect(transaction.to).toBe(token);
    expect(transaction.value).toBe(0n);
    expect(transaction.data).toBe(data);
  });

  it('signs the exact Solana v0 message with the wallet slot key', async () => {
    const core = new ReferenceHostSarKeyCore();
    const wallet = await core.createWallet();
    const from = wallet.addresses.find(({ addressGroupId }) => addressGroupId === 'solana')!.address;
    const payer = new PublicKey(from);
    const message = new TransactionMessage({
      payerKey: payer,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [SystemProgram.transfer({ fromPubkey: payer, toPubkey: new PublicKey('Vote111111111111111111111111111111111111111'), lamports: 1 })],
    }).compileToV0Message();
    const unsigned = new VersionedTransaction(message);
    const signedBase64 = await core.signSolanaTransactionForAddress(from, Buffer.from(unsigned.serialize()).toString('base64'));
    const signed = VersionedTransaction.deserialize(Buffer.from(signedBase64, 'base64'));

    expect(signed.message.serialize()).toEqual(unsigned.message.serialize());
    await expect(verifyAsync(signed.signatures[0]!, signed.message.serialize(), payer.toBytes())).resolves.toBe(true);
  });

  it('signs an exact XRPL issued-currency payment with the wallet slot key', async () => {
    const core = new ReferenceHostSarKeyCore();
    const wallet = await core.createWallet();
    const from = wallet.addresses.find(({ addressGroupId }) => addressGroupId === 'xrp')!.address;
    const blob = await core.signXrplTransactionForAddress(from, {
      TransactionType: 'Payment',
      Account: from,
      Destination: 'rHb9CJAWyB4rj91VRWn96DkukG4bwdtyTh',
      Amount: {
        currency: '524C555344000000000000000000000000000000',
        issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
        value: '1',
      },
      Flags: 0x8000_0000,
      Sequence: 1,
      Fee: '12',
      LastLedgerSequence: 100,
    });
    const payment = decode(blob);

    expect(payment.Account).toBe(from);
    expect(payment.TransactionType).toBe('Payment');
    expect(payment.Amount).toEqual({
      currency: '524C555344000000000000000000000000000000',
      issuer: 'rMxCKbEDwqr76QuheSUMdEGf4B9xJ8m5De',
      value: '1',
    });
  });
});
