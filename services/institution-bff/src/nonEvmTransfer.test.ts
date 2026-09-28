import { describe, expect, it } from 'vitest';
import type { SecureTransactionSigningRequest } from '@took-wss/contracts';
import {
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { TronWeb, utils as tronUtils } from 'tronweb';
import { Wallet } from 'xrpl';
import {
  verifySolanaNativeTransfer,
  verifySolanaSplTransfer,
  verifyTronNativeTransfer,
  verifyTronTrc20Transfer,
  verifyXrplNativeTransfer,
  verifyXrplIssuedTransfer,
} from './nonEvmTransfer';

type SolanaTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'solana-spl' }>;
type SolanaNativeTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'solana-native' }>;
type TronTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'tron-trc20' }>;
type TronNativeTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'tron-native' }>;
type XrplTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'xrpl-issued' }>;
type XrplNativeTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'xrpl-native' }>;

describe('non-EVM signed transfer verification', () => {
  it('accepts only a valid signature over the exact prepared Solana message', async () => {
    const signer = Keypair.generate();
    const message = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new PublicKey('Vote111111111111111111111111111111111111111'),
        lamports: 1,
      })],
    }).compileToV0Message();
    const unsigned = new VersionedTransaction(message);
    const expected: SolanaTransaction = {
      type: 'solana-spl',
      unsignedTransactionBase64: Buffer.from(unsigned.serialize()).toString('base64'),
      recentBlockhash: message.recentBlockhash,
      lastValidBlockHeight: 100,
      mintAddress: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      sourceTokenAccount: signer.publicKey.toBase58(),
      destinationTokenAccount: 'Vote111111111111111111111111111111111111111',
      amountAtomic: '1',
      feeLamports: '5000',
    };
    const signed = new VersionedTransaction(message);
    signed.sign([signer]);
    const serialized = Buffer.from(signed.serialize()).toString('base64');

    await expect(verifySolanaSplTransfer({
      fromAddress: signer.publicKey.toBase58(),
      signedTransactionBase64: serialized,
      expected,
    })).resolves.toEqual(expect.objectContaining({ transactionHash: expect.any(String) }));

    const other = Keypair.generate();
    await expect(verifySolanaSplTransfer({
      fromAddress: other.publicKey.toBase58(),
      signedTransactionBase64: serialized,
      expected,
    })).rejects.toThrow('signed_transaction_mismatch');
  });

  it('verifies an exact native SOL transfer signature', async () => {
    const signer = Keypair.generate();
    const message = new TransactionMessage({
      payerKey: signer.publicKey,
      recentBlockhash: '11111111111111111111111111111111',
      instructions: [SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new PublicKey('Vote111111111111111111111111111111111111111'),
        lamports: 1,
      })],
    }).compileToV0Message();
    const unsigned = new VersionedTransaction(message);
    const expected: SolanaNativeTransaction = {
      type: 'solana-native',
      unsignedTransactionBase64: Buffer.from(unsigned.serialize()).toString('base64'),
      recentBlockhash: message.recentBlockhash,
      lastValidBlockHeight: 100,
      amountLamports: '1',
      feeLamports: '5000',
    };
    const signed = new VersionedTransaction(message);
    signed.sign([signer]);

    await expect(verifySolanaNativeTransfer({
      fromAddress: signer.publicKey.toBase58(),
      signedTransactionBase64: Buffer.from(signed.serialize()).toString('base64'),
      expected,
    })).resolves.toEqual(expect.objectContaining({ transactionHash: expect.any(String) }));
  });

  it('recovers the TRON signer from the prepared transaction ID', () => {
    const privateKey = '1'.padStart(64, '0');
    const fromAddress = TronWeb.address.fromPrivateKey(privateKey);
    if (!fromAddress) throw new Error('TRON test key did not derive an address.');
    const unsigned = { txID: 'ab'.repeat(32), raw_data_hex: '00' };
    const signed = tronUtils.crypto.signTransaction(privateKey, { ...unsigned });
    const expected: TronTransaction = {
      type: 'tron-trc20',
      unsignedTransactionJson: JSON.stringify(unsigned),
      transactionId: unsigned.txID,
      tokenAddress: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
      amountAtomic: '1000000',
      feeLimitSun: '100000000',
    };

    expect(verifyTronTrc20Transfer({
      fromAddress,
      signedTransactionJson: JSON.stringify(signed),
      expected,
    }).transactionHash).toBe(unsigned.txID);
    expect(() => verifyTronTrc20Transfer({
      fromAddress: 'TXLAQ63Xg1NAzckPwKHvzw7CSEmLMEqcdj',
      signedTransactionJson: JSON.stringify(signed),
      expected,
    })).toThrow('invalid_tron_signature');
  });

  it('recovers the native TRX signer from the exact prepared transaction ID', () => {
    const privateKey = '2'.padStart(64, '0');
    const fromAddress = TronWeb.address.fromPrivateKey(privateKey);
    if (!fromAddress) throw new Error('TRON test key did not derive an address.');
    const unsigned = { txID: 'cd'.repeat(32), raw_data_hex: '01' };
    const signed = tronUtils.crypto.signTransaction(privateKey, { ...unsigned });
    const expected: TronNativeTransaction = {
      type: 'tron-native',
      unsignedTransactionJson: JSON.stringify(unsigned),
      transactionId: unsigned.txID,
      amountSun: '1000000',
      feeLimitSun: '1100000',
    };

    expect(verifyTronNativeTransfer({
      fromAddress,
      signedTransactionJson: JSON.stringify(signed),
      expected,
    }).transactionHash).toBe(unsigned.txID);
  });

  it('rejects any XRPL field that was not in the prepared payment', () => {
    const signer = Wallet.generate();
    const issuer = Wallet.generate();
    const recipient = Wallet.generate();
    const payment: XrplTransaction['payment'] = {
      TransactionType: 'Payment',
      Account: signer.address,
      Destination: recipient.address,
      Amount: { currency: '524C555344000000000000000000000000000000', issuer: issuer.address, value: '1' },
      DestinationTag: 7,
      Flags: 0x8000_0000,
      Sequence: 1,
      Fee: '12',
      LastLedgerSequence: 100,
    };
    const expected: XrplTransaction = { type: 'xrpl-issued', payment, snapshotLedgerIndex: 96 };
    const signed = signer.sign(payment);

    expect(verifyXrplIssuedTransfer({ signedTransactionBlob: signed.tx_blob, expected })).toBe(signed.hash);

    const withMemo = signer.sign({
      ...payment,
      Memos: [{ Memo: { MemoData: '74616D7065726564' } }],
    });
    expect(() => verifyXrplIssuedTransfer({ signedTransactionBlob: withMemo.tx_blob, expected }))
      .toThrow('signed_transaction_mismatch');
  });

  it('verifies an exact native XRP payment', () => {
    const signer = Wallet.generate();
    const recipient = Wallet.generate();
    const payment: XrplNativeTransaction['payment'] = {
      TransactionType: 'Payment',
      Account: signer.address,
      Destination: recipient.address,
      Amount: '1000000',
      Flags: 0x8000_0000,
      Sequence: 1,
      Fee: '12',
      LastLedgerSequence: 100,
    };
    const expected: XrplNativeTransaction = { type: 'xrpl-native', payment, snapshotLedgerIndex: 96 };
    const signed = signer.sign(payment);

    expect(verifyXrplNativeTransfer({ signedTransactionBlob: signed.tx_blob, expected })).toBe(signed.hash);
  });
});
