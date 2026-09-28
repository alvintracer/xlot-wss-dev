import { describe, expect, it } from 'vitest';
import { p2pkh, Transaction } from '@scure/btc-signer';
import { pubECDSA } from '@scure/btc-signer/utils.js';
import type { SecureTransactionSigningRequest } from '@took-wss/contracts';
import { verifyBitcoinNativeTransfer } from './bitcoinTransfer';

type BitcoinTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'bitcoin-native' }>;

function privateKey(lastByte: number): Uint8Array {
  const key = new Uint8Array(32);
  key[31] = lastByte;
  return key;
}

describe('Bitcoin signed transfer verification', () => {
  it('verifies the exact P2PKH inputs, outputs, fee, owner, and signatures', () => {
    const signerKey = privateKey(1);
    const sender = p2pkh(pubECDSA(signerKey)).address!;
    const recipient = p2pkh(pubECDSA(privateKey(2))).address!;
    const funding = new Transaction();
    funding.addOutputAddress(sender, 100_000n);
    funding.addInput({
      txid: new Uint8Array(32),
      index: 0xffff_ffff,
      finalScriptSig: new Uint8Array([1, 1]),
      sequence: 0xffff_ffff,
    });
    const fundingBytes = funding.toBytes();
    const fundingId = Transaction.fromRaw(fundingBytes).id;
    const unsigned = new Transaction({ strictPrevoutValidation: true });
    unsigned.addOutputAddress(recipient, 80_000n);
    unsigned.addOutputAddress(sender, 10_000n);
    unsigned.addInput({
      txid: Buffer.from(fundingId, 'hex'),
      index: 0,
      nonWitnessUtxo: fundingBytes,
    });
    const unsignedPsbtBase64 = Buffer.from(unsigned.toPSBT()).toString('base64');
    const expected: BitcoinTransaction = {
      type: 'bitcoin-native',
      unsignedPsbtBase64,
      amountSatoshis: '80000',
      feeSatoshis: '10000',
      changeSatoshis: '10000',
      feeRateSatsPerVbyte: '1',
      inputCount: 1,
    };
    const signed = Transaction.fromPSBT(Buffer.from(unsignedPsbtBase64, 'base64'), { strictPrevoutValidation: true });
    expect(signed.sign(signerKey)).toBe(1);
    signed.finalize();

    expect(verifyBitcoinNativeTransfer({
      fromAddress: sender,
      recipient,
      signedTransactionHex: signed.hex,
      expected,
    })).toEqual({ transactionHash: signed.id, transactionHex: signed.hex });

    expect(() => verifyBitcoinNativeTransfer({
      fromAddress: recipient,
      recipient,
      signedTransactionHex: signed.hex,
      expected,
    })).toThrow('signed_transaction_mismatch');
  });
});
