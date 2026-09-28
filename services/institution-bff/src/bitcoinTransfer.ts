import { Address, p2pkh, Script, selectUTXO, Transaction } from '@scure/btc-signer';
import { EsploraProvider } from '@scure/btc-signer/net.js';
import { secp256k1 } from '@noble/curves/secp256k1';
import type { SecureTransactionSigningRequest } from '@took-wss/contracts';

type BitcoinSigningTransaction = Extract<SecureTransactionSigningRequest['transaction'], { type: 'bitcoin-native' }>;

const BITCOIN_DUST_SATOSHIS = 546n;
const BITCOIN_MAX_INPUTS = 24;
const BITCOIN_MAX_FEE_RATE = 1_000n;
const SIGHASH_ALL = 1;

function provider(rpcUrl: string): EsploraProvider {
  return new EsploraProvider(
    (url, options) => fetch(url, options),
    rpcUrl.replace(/\/$/, ''),
  );
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function previousOutput(transaction: Transaction, inputIndex: number): { amount: bigint; script: Uint8Array } {
  const input = transaction.getInput(inputIndex);
  if (input.witnessUtxo) return input.witnessUtxo;
  if (input.index === undefined) throw new Error('bitcoin_prevout_unavailable');
  const output = input.nonWitnessUtxo?.outputs[input.index];
  if (!output) throw new Error('bitcoin_prevout_unavailable');
  return output;
}

export async function prepareBitcoinNativeTransfer(input: {
  rpcUrl: string;
  fromAddress: string;
  recipient: string;
  amountAtomic: bigint;
}): Promise<{ transaction: BitcoinSigningTransaction; feeAtomic: bigint }> {
  if (input.fromAddress === input.recipient) throw new Error('self_transfer_not_allowed');
  try {
    Address().decode(input.recipient);
  } catch {
    throw new Error('invalid_recipient');
  }
  const esplora = provider(input.rpcUrl);
  const [unspent, feeRate] = await Promise.all([
    esplora.unspent(input.fromAddress),
    esplora.fee(3),
  ]);
  if (feeRate <= 0n || feeRate > BITCOIN_MAX_FEE_RATE) throw new Error('bitcoin_network_fee_unavailable');
  if (unspent.balance < input.amountAtomic) throw new Error('insufficient_balance');
  const selected = selectUTXO(
    unspent.utxo,
    [{ address: input.recipient, amount: input.amountAtomic }],
    'default',
    {
      feePerByte: feeRate,
      changeAddress: input.fromAddress,
      dust: BITCOIN_DUST_SATOSHIS,
      strictPrevoutValidation: true,
    },
  );
  if (!selected?.tx || selected.fee === undefined) throw new Error('insufficient_balance_for_fee');
  if (selected.inputs.length < 1 || selected.inputs.length > BITCOIN_MAX_INPUTS) {
    throw new Error('bitcoin_input_limit_exceeded');
  }
  const changeSatoshis = selected.outputs.reduce((sum, output) => (
    'address' in output && output.address === input.fromAddress ? sum + output.amount : sum
  ), 0n);
  return {
    transaction: {
      type: 'bitcoin-native',
      unsignedPsbtBase64: Buffer.from(selected.tx.toPSBT()).toString('base64'),
      amountSatoshis: input.amountAtomic.toString(),
      feeSatoshis: selected.fee.toString(),
      changeSatoshis: changeSatoshis.toString(),
      feeRateSatsPerVbyte: feeRate.toString(),
      inputCount: selected.inputs.length,
    },
    feeAtomic: selected.fee,
  };
}

export function verifyBitcoinNativeTransfer(input: {
  fromAddress: string;
  recipient: string;
  signedTransactionHex: string;
  expected: BitcoinSigningTransaction;
}): { transactionHash: string; transactionHex: string } {
  if (!/^[0-9a-fA-F]+$/.test(input.signedTransactionHex) || input.signedTransactionHex.length % 2 !== 0) {
    throw new Error('invalid_bitcoin_signed_transaction');
  }
  const signed = Transaction.fromRaw(Buffer.from(input.signedTransactionHex, 'hex'));
  const unsigned = Transaction.fromPSBT(Buffer.from(input.expected.unsignedPsbtBase64, 'base64'), {
    strictPrevoutValidation: true,
  });
  if (signed.hasWitnesses
    || signed.version !== unsigned.version
    || signed.lockTime !== unsigned.lockTime
    || signed.inputsLength !== unsigned.inputsLength
    || signed.inputsLength !== input.expected.inputCount
    || signed.outputsLength !== unsigned.outputsLength
    || unsigned.fee !== BigInt(input.expected.feeSatoshis)) {
    throw new Error('signed_transaction_mismatch');
  }
  let recipientAmount = 0n;
  let changeAmount = 0n;
  for (let index = 0; index < signed.outputsLength; index += 1) {
    const actual = signed.getOutput(index);
    const expected = unsigned.getOutput(index);
    if (actual.amount === undefined || !actual.script || expected.amount === undefined || !expected.script
      || actual.amount !== expected.amount || !equalBytes(actual.script, expected.script)) {
      throw new Error('signed_transaction_mismatch');
    }
    const address = signed.getOutputAddress(index);
    if (address === input.recipient) recipientAmount += actual.amount;
    else if (address === input.fromAddress) changeAmount += actual.amount;
    else throw new Error('signed_transaction_mismatch');
  }
  if (recipientAmount !== BigInt(input.expected.amountSatoshis)
    || changeAmount !== BigInt(input.expected.changeSatoshis)) throw new Error('signed_transaction_mismatch');

  for (let index = 0; index < signed.inputsLength; index += 1) {
    const actual = signed.getInput(index);
    const expected = unsigned.getInput(index);
    if (!actual.txid || !expected.txid || !actual.finalScriptSig
      || !equalBytes(actual.txid, expected.txid)
      || actual.index !== expected.index
      || actual.sequence !== expected.sequence) throw new Error('signed_transaction_mismatch');
    const stack = Script.decode(actual.finalScriptSig);
    if (stack.length !== 2 || !(stack[0] instanceof Uint8Array) || !(stack[1] instanceof Uint8Array)) {
      throw new Error('invalid_bitcoin_signature');
    }
    const [signatureWithHashType, publicKey] = stack;
    const hashType = signatureWithHashType.at(-1);
    if (hashType !== SIGHASH_ALL || p2pkh(publicKey).address !== input.fromAddress) {
      throw new Error('invalid_bitcoin_signature');
    }
    const prevout = previousOutput(unsigned, index);
    if (!equalBytes(prevout.script, p2pkh(publicKey).script)) throw new Error('invalid_bitcoin_signature');
    const signature = secp256k1.Signature.fromDER(signatureWithHashType.slice(0, -1));
    const transactionHash = (signed as unknown as {
      preimageLegacy: (inputIndex: number, script: Uint8Array, sighashType: number) => Uint8Array;
    }).preimageLegacy(index, prevout.script, hashType);
    if (!secp256k1.verify(signature, transactionHash, publicKey, { lowS: true })) {
      throw new Error('invalid_bitcoin_signature');
    }
  }
  return { transactionHash: signed.id, transactionHex: signed.hex };
}

export async function submitBitcoinNativeTransfer(input: {
  rpcUrl: string;
  fromAddress: string;
  recipient: string;
  signedTransactionHex: string;
  expected: BitcoinSigningTransaction;
  authorize: (transactionHash: string) => Promise<void>;
}): Promise<string> {
  const verified = verifyBitcoinNativeTransfer(input);
  await input.authorize(verified.transactionHash);
  const broadcastHash = await provider(input.rpcUrl).sendTx(verified.transactionHex);
  if (broadcastHash.toLowerCase() !== verified.transactionHash.toLowerCase()) {
    throw new Error('bitcoin_transaction_hash_mismatch');
  }
  return verified.transactionHash;
}
