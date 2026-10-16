import { describe, expect, it } from 'vitest';
import { verifyAsync } from '@noble/ed25519';
import { Transaction as BitcoinTransaction } from '@scure/btc-signer';
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import { ethers } from 'ethers';
import { combine } from 'shamir-secret-sharing';
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

  it('restores an EVM signer from only the B and C vault shares after a reload', async () => {
    const original = new ReferenceHostSarKeyCore();
    const wallet = await original.prepareImportedEvmPrivateKey(ethers.Wallet.createRandom().privateKey);
    const address = wallet.addresses[0]!.address;
    const material = await original.exportVaultSharesForAddress('evm', address);
    const restored = new ReferenceHostSarKeyCore();
    await restored.restoreVaultSharesForAddress(
      [material.shares[1], material.shares[2]],
      material.kind,
      'evm',
      address,
    );
    for (const share of material.shares) share.fill(0);
    expect(restored.hasSignerForAddress('evm', address)).toBe(true);
    const signed = await restored.signEvmTransactionForAddress(address, {
      chainId: 1,
      nonce: 0,
      to: '0x0000000000000000000000000000000000000001',
      value: '1',
      gasLimit: '21000',
      gasPrice: '1',
    });
    expect(ethers.Transaction.from(signed).from).toBe(address);
  });

  it('signs raw Coinone challenge bytes instead of the hex characters', async () => {
    const core = new ReferenceHostSarKeyCore();
    const wallet = await core.prepareImportedEvmPrivateKey(ethers.Wallet.createRandom().privateKey);
    const address = wallet.addresses[0]!.address;
    const challenge = ethers.toUtf8Bytes('Coinone wallet ownership');
    const signature = await core.signEvmMessageForAddress(address, challenge);
    expect(ethers.verifyMessage(challenge, signature)).toBe(address);
    expect(ethers.verifyMessage(ethers.hexlify(challenge), signature)).not.toBe(address);
    challenge.fill(0);
    await core.discardWallet(wallet.keyHandle);
  });

  it('reconstructs the third share from a saved local pair after enrollment was interrupted', async () => {
    const core = new ReferenceHostSarKeyCore();
    const wallet = await core.prepareImportedMnemonic('test test test test test test test test test test test junk');
    const address = wallet.addresses.find((item) => item.addressGroupId === 'evm')!.address;
    const original = await core.exportVaultSharesForKeyHandle(wallet.keyHandle);
    await core.discardWallet(wallet.keyHandle);
    expect(ethers.hexlify(await combine([original.shares[0], original.shares[1]])))
      .toBe(ethers.Mnemonic.fromPhrase('test test test test test test test test test test test junk').entropy);
    await expect(core.resumeWalletFromVaultShares(
      [original.shares[0], original.shares[1]], original.kind, 'evm',
      '0x0000000000000000000000000000000000000001',
    )).rejects.toThrow('recovery_address_mismatch');
    const resumedHandle = await core.resumeWalletFromVaultShares(
      [original.shares[0], original.shares[1]], original.kind, 'evm', address,
    );
    expect(await core.verifyRecovery(resumedHandle, [0, 1])).toBe(true);
    expect(await core.verifyRecovery(resumedHandle, [0, 2])).toBe(true);
    expect(await core.verifyRecovery(resumedHandle, [1, 2])).toBe(true);
    const resumedShares = await core.exportVaultSharesForKeyHandle(resumedHandle);
    expect(resumedShares.shares[0]).toEqual(original.shares[0]);
    expect(resumedShares.shares[1]).toEqual(original.shares[1]);
    for (const share of [...original.shares, ...resumedShares.shares]) share.fill(0);
    await core.discardWallet(resumedHandle);
  });

  it('preserves recovery across randomized share coordinates when resuming', async () => {
    const core = new ReferenceHostSarKeyCore();
    for (let index = 0; index < 8; index += 1) {
      const privateKey = ethers.Wallet.createRandom().privateKey;
      const wallet = await core.prepareImportedEvmPrivateKey(privateKey);
      const address = wallet.addresses[0]!.address;
      const original = await core.exportVaultSharesForKeyHandle(wallet.keyHandle);
      await core.discardWallet(wallet.keyHandle);
      const handle = await core.resumeWalletFromVaultShares(
        [original.shares[1], original.shares[0]], original.kind, 'evm', address,
      );
      const resumed = await core.exportVaultSharesForKeyHandle(handle);
      for (const pair of [[0, 1], [0, 2], [1, 2]] as const) {
        const secret = await combine([resumed.shares[pair[0]], resumed.shares[pair[1]]]);
        expect(ethers.hexlify(secret)).toBe(privateKey);
        secret.fill(0);
      }
      if (original.shares[2].at(-1) === resumed.shares[2].at(-1)) {
        expect(resumed.shares[2]).toEqual(original.shares[2]);
      } else {
        const oldAndNew = await combine([original.shares[2], resumed.shares[2]]);
        expect(ethers.hexlify(oldAndNew)).toBe(privateKey);
        oldAndNew.fill(0);
      }
      for (const share of [...original.shares, ...resumed.shares]) share.fill(0);
      await core.discardWallet(handle);
    }
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

  it('accepts numbered or comma-separated recovery words copied from another wallet', async () => {
    const core = new ReferenceHostSarKeyCore();
    const phrase = ethers.Wallet.createRandom().mnemonic!.phrase;
    const numbered = phrase.split(' ').map((word, index) => `${index + 1}. ${word}`).join('\n');
    const wallet = await core.prepareImportedMnemonic(numbered);
    expect(wallet.addresses.find(({ addressGroupId }) => addressGroupId === 'evm')?.address)
      .toBe(ethers.HDNodeWallet.fromPhrase(phrase, undefined, "m/44'/60'/0'/0/0").address);
    const commaSeparated = await core.prepareImportedMnemonic(phrase.replaceAll(' ', ', '));
    expect(commaSeparated.addresses).toEqual(wallet.addresses);
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

  it('signs and finalizes the exact Bitcoin P2PKH PSBT with the wallet slot key', async () => {
    const core = new ReferenceHostSarKeyCore();
    const wallet = await core.createWallet();
    const from = wallet.addresses.find(({ addressGroupId }) => addressGroupId === 'bitcoin')!.address;
    const funding = new BitcoinTransaction();
    funding.addOutputAddress(from, 100_000n);
    funding.addInput({
      txid: new Uint8Array(32),
      index: 0xffff_ffff,
      finalScriptSig: new Uint8Array([1, 1]),
      sequence: 0xffff_ffff,
    });
    const fundingBytes = funding.toBytes();
    const fundingId = BitcoinTransaction.fromRaw(fundingBytes).id;
    const unsigned = new BitcoinTransaction({ strictPrevoutValidation: true });
    unsigned.addOutputAddress(from, 90_000n);
    unsigned.addInput({
      txid: Buffer.from(fundingId, 'hex'),
      index: 0,
      nonWitnessUtxo: fundingBytes,
    });
    const signedHex = await core.signBitcoinTransactionForAddress(
      from,
      Buffer.from(unsigned.toPSBT()).toString('base64'),
    );
    const signed = BitcoinTransaction.fromRaw(Buffer.from(signedHex, 'hex'));

    expect(signed.isFinal).toBe(true);
    expect(signed.outputsLength).toBe(1);
    expect(signed.getOutputAddress(0)).toBe(from);
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
