import { getPublicKeyAsync, signAsync } from '@noble/ed25519';
import { ethers } from 'ethers';
import { encodeAccountID } from 'ripple-address-codec';
import { combine, split } from 'shamir-secret-sharing';

export const SAR_KEY_CORE_VERSION = 'sar-key-core-v1' as const;

export type SarAddressGroupId = 'evm' | 'solana' | 'bitcoin' | 'tron' | 'xrp';

export interface SarPublicAddress {
  addressGroupId: SarAddressGroupId;
  address: string;
}

export interface SarRecoveryEnvelope {
  factorIndex: 1 | 2 | 3;
  envelopeVersion: 1;
  algorithm: 'AES-256-GCM';
  ivBase64: string;
  ciphertextBase64: string;
  aad: string;
}

export interface SarWalletCreationResult {
  keyHandle: string;
  addresses: SarPublicAddress[];
  recoveryEnvelopes: SarRecoveryEnvelope[];
  recovery: {
    scheme: 'shamir-gf256';
    threshold: 2;
    shareCount: 3;
    recombinationVerified: true;
    keyCoreVersion: typeof SAR_KEY_CORE_VERSION;
  };
}

export interface PreparedSarWallet {
  mnemonicWords: readonly string[];
  wallet: SarWalletCreationResult;
}

export interface EvmTransactionToSign {
  chainId: number;
  nonce: number;
  to: string;
  value: string;
  gasLimit: string;
  gasPrice: string;
  data?: string;
}

export type EvmNativeTransactionToSign = EvmTransactionToSign;

interface SarShareStore {
  put(keyHandle: string, share: Uint8Array): Promise<void>;
  get(keyHandle: string): Promise<Uint8Array | null>;
  delete(keyHandle: string): Promise<void>;
}

type SarSecretKind = 'mnemonic-entropy' | 'evm-private-key';

class VolatileShareStore implements SarShareStore {
  readonly #shares = new Map<string, Uint8Array>();

  async put(keyHandle: string, share: Uint8Array): Promise<void> {
    this.#shares.set(keyHandle, share.slice());
  }

  async get(keyHandle: string): Promise<Uint8Array | null> {
    return this.#shares.get(keyHandle)?.slice() ?? null;
  }

  async delete(keyHandle: string): Promise<void> {
    this.#shares.get(keyHandle)?.fill(0);
    this.#shares.delete(keyHandle);
  }
}

function asBufferSource(bytes: Uint8Array): BufferSource {
  return bytes as unknown as BufferSource;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptRecoveryEnvelope(
  share: Uint8Array,
  key: CryptoKey,
  keyHandle: string,
  factorIndex: 1 | 2 | 3,
): Promise<SarRecoveryEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const aad = `${SAR_KEY_CORE_VERSION}:${keyHandle}:factor-${factorIndex}`;
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asBufferSource(iv), additionalData: asBufferSource(new TextEncoder().encode(aad)) },
    key,
    asBufferSource(share),
  ));
  const envelope = {
    factorIndex,
    envelopeVersion: 1,
    algorithm: 'AES-256-GCM',
    ivBase64: bytesToBase64(iv),
    ciphertextBase64: bytesToBase64(ciphertext),
    aad,
  } as const;
  iv.fill(0);
  ciphertext.fill(0);
  return envelope;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = value * 256n + BigInt(byte);
  let encoded = '';
  while (value > 0n) {
    encoded = BASE58_ALPHABET[Number(value % 58n)] + encoded;
    value /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    encoded = `1${encoded}`;
  }
  return encoded;
}

async function base58CheckEncode(payload: Uint8Array): Promise<string> {
  const firstHash = ethers.getBytes(ethers.sha256(payload));
  const secondHash = ethers.getBytes(ethers.sha256(firstHash));
  const result = new Uint8Array(payload.length + 4);
  result.set(payload);
  result.set(secondHash.slice(0, 4), payload.length);
  const encoded = base58Encode(result);
  firstHash.fill(0);
  secondHash.fill(0);
  result.fill(0);
  return encoded;
}

async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    asBufferSource(key),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, asBufferSource(data)));
}

async function deriveSlip10Ed25519(seed: Uint8Array, path: readonly number[]): Promise<Uint8Array> {
  const masterKey = new TextEncoder().encode('ed25519 seed');
  let digest = await hmacSha512(masterKey, seed);
  let key = digest.slice(0, 32);
  let chainCode = digest.slice(32);
  digest.fill(0);

  for (const index of path) {
    const input = new Uint8Array(37);
    input[0] = 0;
    input.set(key, 1);
    const view = new DataView(input.buffer);
    view.setUint32(33, index, false);
    digest = await hmacSha512(chainCode, input);
    key.fill(0);
    chainCode.fill(0);
    input.fill(0);
    key = digest.slice(0, 32);
    chainCode = digest.slice(32);
    digest.fill(0);
  }

  chainCode.fill(0);
  return key;
}

async function deriveAddresses(mnemonic: string): Promise<SarPublicAddress[]> {
  let seed = new Uint8Array();
  let solanaPrivateKey = new Uint8Array();
  try {
    seed = Uint8Array.from(ethers.getBytes(ethers.Mnemonic.fromPhrase(mnemonic).computeSeed()));
    const root = ethers.HDNodeWallet.fromSeed(seed);

    const evm = root.derivePath("m/44'/60'/0'/0/0").address;

    const bitcoinChild = root.derivePath("m/44'/0'/0'/0/0");
    const bitcoinPublicKey = ethers.getBytes(new ethers.SigningKey(bitcoinChild.privateKey).compressedPublicKey);
    const bitcoinHash160 = ethers.getBytes(ethers.ripemd160(ethers.sha256(bitcoinPublicKey)));
    const bitcoinPayload = new Uint8Array(21);
    bitcoinPayload.set(bitcoinHash160, 1);
    const bitcoin = await base58CheckEncode(bitcoinPayload);

    const tronChild = root.derivePath("m/44'/195'/0'/0/0");
    const tronEvmAddress = ethers.getBytes(tronChild.address);
    const tronPayload = new Uint8Array(21);
    tronPayload[0] = 0x41;
    tronPayload.set(tronEvmAddress, 1);
    const tron = await base58CheckEncode(tronPayload);

    const xrpChild = root.derivePath("m/44'/144'/0'/0/0");
    const xrpPublicKey = ethers.getBytes(new ethers.SigningKey(xrpChild.privateKey).compressedPublicKey);
    const xrpAccountId = ethers.getBytes(ethers.ripemd160(ethers.sha256(xrpPublicKey)));
    const xrp = encodeAccountID(xrpAccountId);

    solanaPrivateKey = Uint8Array.from(await deriveSlip10Ed25519(seed, [0x8000002c, 0x800001f5, 0x80000000, 0x80000000]));
    const solanaPublicKey = await getPublicKeyAsync(solanaPrivateKey);
    const solana = base58Encode(solanaPublicKey);

    bitcoinPublicKey.fill(0);
    bitcoinHash160.fill(0);
    bitcoinPayload.fill(0);
    tronEvmAddress.fill(0);
    tronPayload.fill(0);
    xrpPublicKey.fill(0);
    xrpAccountId.fill(0);
    solanaPublicKey.fill(0);

    return [
      { addressGroupId: 'evm', address: evm },
      { addressGroupId: 'solana', address: solana },
      { addressGroupId: 'bitcoin', address: bitcoin },
      { addressGroupId: 'tron', address: tron },
      { addressGroupId: 'xrp', address: xrp },
    ];
  } finally {
    seed.fill(0);
    solanaPrivateKey.fill(0);
  }
}

/**
 * Development host key core with real derivation and Shamir recovery math.
 * Its three volatile stores model separate trust boundaries but are not durable
 * or hardware-backed; production hosts must replace this class with an approved
 * native key core and independently controlled share stores.
 */
export class ReferenceHostSarKeyCore {
  readonly #stores: readonly [SarShareStore, SarShareStore, SarShareStore];
  readonly #publicAddresses = new Map<string, SarPublicAddress[]>();
  readonly #developmentVaultKeys = new Map<string, CryptoKey>();
  readonly #secretKinds = new Map<string, SarSecretKind>();

  constructor() {
    this.#stores = [new VolatileShareStore(), new VolatileShareStore(), new VolatileShareStore()];
  }

  async createWallet(): Promise<SarWalletCreationResult> {
    return (await this.prepareWallet()).wallet;
  }

  async prepareWallet(): Promise<PreparedSarWallet> {
    const entropy = crypto.getRandomValues(new Uint8Array(16));
    try {
      const mnemonic = ethers.Mnemonic.fromEntropy(entropy).phrase;
      const addresses = await deriveAddresses(mnemonic);
      return {
        mnemonicWords: Object.freeze(mnemonic.split(' ')),
        wallet: await this.#registerSecret(entropy, 'mnemonic-entropy', addresses),
      };
    } finally {
      entropy.fill(0);
    }
  }

  async prepareImportedMnemonic(phrase: string): Promise<SarWalletCreationResult> {
    const normalized = phrase.normalize('NFKD').trim().toLocaleLowerCase('en-US').split(/\s+/u).join(' ');
    if (!ethers.Mnemonic.isValidMnemonic(normalized)) throw new Error('invalid_mnemonic');
    const mnemonic = ethers.Mnemonic.fromPhrase(normalized);
    const entropy = Uint8Array.from(ethers.getBytes(mnemonic.entropy));
    try {
      return await this.#registerSecret(entropy, 'mnemonic-entropy', await deriveAddresses(mnemonic.phrase));
    } finally {
      entropy.fill(0);
    }
  }

  async prepareImportedEvmPrivateKey(value: string): Promise<SarWalletCreationResult> {
    const normalized = value.trim();
    if (!/^(?:0x)?[0-9a-fA-F]{64}$/u.test(normalized)) throw new Error('invalid_private_key');
    const privateKey = Uint8Array.from(ethers.getBytes(normalized.startsWith('0x') ? normalized : `0x${normalized}`));
    try {
      const signer = new ethers.Wallet(ethers.hexlify(privateKey));
      return await this.#registerSecret(privateKey, 'evm-private-key', [
        { addressGroupId: 'evm', address: signer.address },
      ]);
    } finally {
      privateKey.fill(0);
    }
  }

  async #registerSecret(
    secret: Uint8Array,
    kind: SarSecretKind,
    addresses: SarPublicAddress[],
  ): Promise<SarWalletCreationResult> {
    const keyHandle = `sar-key-${crypto.randomUUID()}`;
    const vaultKeyBytes = crypto.getRandomValues(new Uint8Array(32));
    let shares: Uint8Array[] = [];
    try {
      shares = await split(secret, 3, 2);
      if (shares.length !== 3) throw new Error('SAR share generation failed.');
      for (const pair of [[0, 1], [0, 2], [1, 2]] as const) {
        const recovered = await combine([shares[pair[0]]!, shares[pair[1]]!]);
        const verified = equalBytes(secret, recovered);
        recovered.fill(0);
        if (!verified) throw new Error('SAR recovery verification failed.');
      }
      const vaultKey = await crypto.subtle.importKey(
        'raw',
        asBufferSource(vaultKeyBytes),
        { name: 'AES-GCM' },
        false,
        ['encrypt', 'decrypt'],
      );
      const recoveryEnvelopes = await Promise.all(shares.map((share, index) => (
        encryptRecoveryEnvelope(share, vaultKey, keyHandle, (index + 1) as 1 | 2 | 3)
      )));
      await Promise.all(this.#stores.map((store, index) => store.put(keyHandle, shares[index]!)));
      this.#publicAddresses.set(keyHandle, addresses.map((address) => ({ ...address })));
      this.#developmentVaultKeys.set(keyHandle, vaultKey);
      this.#secretKinds.set(keyHandle, kind);
      return {
        keyHandle,
        addresses,
        recoveryEnvelopes,
        recovery: {
          scheme: 'shamir-gf256',
          threshold: 2,
          shareCount: 3,
          recombinationVerified: true,
          keyCoreVersion: SAR_KEY_CORE_VERSION,
        },
      };
    } catch (error) {
      await Promise.all(this.#stores.map((store) => store.delete(keyHandle)));
      this.#publicAddresses.delete(keyHandle);
      this.#developmentVaultKeys.delete(keyHandle);
      this.#secretKinds.delete(keyHandle);
      throw error;
    } finally {
      vaultKeyBytes.fill(0);
      for (const share of shares) share.fill(0);
    }
  }

  async discardWallet(keyHandle: string): Promise<void> {
    await Promise.all(this.#stores.map((store) => store.delete(keyHandle)));
    this.#publicAddresses.delete(keyHandle);
    this.#developmentVaultKeys.delete(keyHandle);
    this.#secretKinds.delete(keyHandle);
  }

  async #withRecoveredSecret<T>(
    keyHandle: string,
    operation: (secret: Uint8Array, kind: SarSecretKind) => Promise<T>,
  ): Promise<T> {
    const shares = await Promise.all([this.#stores[0].get(keyHandle), this.#stores[1].get(keyHandle)]);
    if (shares.some((share) => share === null)) throw new Error('SAR shares are unavailable.');
    const kind = this.#secretKinds.get(keyHandle);
    if (!kind) throw new Error('SAR secret metadata is unavailable.');
    const secret = await combine(shares as Uint8Array[]);
    try {
      return await operation(secret, kind);
    } finally {
      secret.fill(0);
      for (const share of shares) share?.fill(0);
    }
  }

  async #withRecoveredMnemonic<T>(
    keyHandle: string,
    operation: (mnemonic: string) => Promise<T>,
  ): Promise<T> {
    return this.#withRecoveredSecret(keyHandle, async (secret, kind) => {
      if (kind !== 'mnemonic-entropy') throw new Error('This wallet does not contain a mnemonic signer.');
      return operation(ethers.Mnemonic.fromEntropy(secret).phrase);
    });
  }

  #keyHandleForAddress(addressGroupId: SarAddressGroupId, address: string): string {
    const matching = [...this.#publicAddresses.entries()].find(([, addresses]) => (
      addresses.some((candidate) => candidate.addressGroupId === addressGroupId
        && (addressGroupId === 'evm'
          ? candidate.address.toLowerCase() === address.toLowerCase()
          : candidate.address === address))
    ));
    if (!matching) throw new Error('No key handle is available for this wallet address.');
    return matching[0];
  }

  async signEvmTransactionForAddress(
    fromAddress: string,
    transaction: EvmTransactionToSign,
  ): Promise<string> {
    const keyHandle = this.#keyHandleForAddress('evm', fromAddress);
    return this.#withRecoveredSecret(keyHandle, async (secret, kind) => {
      const seed = kind === 'mnemonic-entropy'
        ? Uint8Array.from(ethers.getBytes(ethers.Mnemonic.fromEntropy(secret).computeSeed()))
        : new Uint8Array();
      try {
        const signer = kind === 'mnemonic-entropy'
          ? ethers.HDNodeWallet.fromSeed(seed).derivePath("m/44'/60'/0'/0/0")
          : new ethers.Wallet(ethers.hexlify(secret));
        if (signer.address.toLowerCase() !== fromAddress.toLowerCase()) throw new Error('Derived signer address mismatch.');
        return await signer.signTransaction({
          type: 0,
          chainId: transaction.chainId,
          nonce: transaction.nonce,
          to: transaction.to,
          value: BigInt(transaction.value),
          gasLimit: BigInt(transaction.gasLimit),
          gasPrice: BigInt(transaction.gasPrice),
          data: transaction.data ?? '0x',
        });
      } finally {
        seed.fill(0);
      }
    });
  }

  async signSolanaTransactionForAddress(fromAddress: string, unsignedTransactionBase64: string): Promise<string> {
    const keyHandle = this.#keyHandleForAddress('solana', fromAddress);
    return this.#withRecoveredMnemonic(keyHandle, async (mnemonic) => {
      const seed = Uint8Array.from(ethers.getBytes(ethers.Mnemonic.fromPhrase(mnemonic).computeSeed()));
      const privateKey = await deriveSlip10Ed25519(seed, [0x8000002c, 0x800001f5, 0x80000000, 0x80000000]);
      try {
        const [{ PublicKey, VersionedTransaction }, publicKeyBytes] = await Promise.all([
          import('@solana/web3.js'),
          getPublicKeyAsync(privateKey),
        ]);
        const publicKey = new PublicKey(publicKeyBytes);
        if (publicKey.toBase58() !== fromAddress) throw new Error('Derived signer address mismatch.');
        const transaction = VersionedTransaction.deserialize(base64ToBytes(unsignedTransactionBase64));
        const payer = transaction.message.staticAccountKeys[0];
        if (!payer || payer.toBase58() !== fromAddress) throw new Error('Solana fee payer mismatch.');
        const signature = await signAsync(transaction.message.serialize(), privateKey);
        transaction.addSignature(publicKey, signature);
        return bytesToBase64(transaction.serialize());
      } finally {
        seed.fill(0);
        privateKey.fill(0);
      }
    });
  }

  async signBitcoinTransactionForAddress(fromAddress: string, unsignedPsbtBase64: string): Promise<string> {
    const keyHandle = this.#keyHandleForAddress('bitcoin', fromAddress);
    return this.#withRecoveredMnemonic(keyHandle, async (mnemonic) => {
      const seed = Uint8Array.from(ethers.getBytes(ethers.Mnemonic.fromPhrase(mnemonic).computeSeed()));
      let privateKey = new Uint8Array();
      try {
        const child = ethers.HDNodeWallet.fromSeed(seed).derivePath("m/44'/0'/0'/0/0");
        privateKey = Uint8Array.from(ethers.getBytes(child.privateKey));
        const [{ Transaction, p2pkh }, { pubECDSA }] = await Promise.all([
          import('@scure/btc-signer'),
          import('@scure/btc-signer/utils.js'),
        ]);
        const payment = p2pkh(pubECDSA(privateKey));
        if (payment.address !== fromAddress) throw new Error('Derived signer address mismatch.');
        const transaction = Transaction.fromPSBT(base64ToBytes(unsignedPsbtBase64), {
          strictPrevoutValidation: true,
        });
        if (transaction.inputsLength < 1 || transaction.inputsLength > 24) {
          throw new Error('Bitcoin input count is outside the approved signing policy.');
        }
        if (transaction.sign(privateKey) !== transaction.inputsLength) {
          throw new Error('Bitcoin transaction contains an input this wallet cannot sign.');
        }
        transaction.finalize();
        if (!transaction.isFinal) throw new Error('Bitcoin transaction finalization failed.');
        return transaction.hex;
      } finally {
        seed.fill(0);
        privateKey.fill(0);
      }
    });
  }

  async signTronTransactionForAddress(fromAddress: string, unsignedTransactionJson: string): Promise<string> {
    const keyHandle = this.#keyHandleForAddress('tron', fromAddress);
    return this.#withRecoveredMnemonic(keyHandle, async (mnemonic) => {
      const seed = Uint8Array.from(ethers.getBytes(ethers.Mnemonic.fromPhrase(mnemonic).computeSeed()));
      try {
        const signer = ethers.HDNodeWallet.fromSeed(seed).derivePath("m/44'/195'/0'/0/0");
        const privateKey = signer.privateKey.slice(2);
        const module = await import('tronweb');
        const TronWebConstructor = module.TronWeb;
        const tronWeb = new TronWebConstructor({ fullHost: 'https://api.trongrid.io', privateKey });
        const derivedAddress = tronWeb.address.fromPrivateKey(privateKey);
        if (derivedAddress !== fromAddress) throw new Error('Derived signer address mismatch.');
        const transaction = JSON.parse(unsignedTransactionJson) as Record<string, unknown>;
        const signed = await tronWeb.trx.sign(transaction as never, privateKey);
        return JSON.stringify(signed);
      } finally {
        seed.fill(0);
      }
    });
  }

  async signXrplTransactionForAddress(
    fromAddress: string,
    payment: unknown,
  ): Promise<string> {
    const keyHandle = this.#keyHandleForAddress('xrp', fromAddress);
    return this.#withRecoveredMnemonic(keyHandle, async (mnemonic) => {
      const { Wallet } = await import('xrpl');
      const wallet = Wallet.fromMnemonic(mnemonic, {
        derivationPath: "m/44'/144'/0'/0/0",
        mnemonicEncoding: 'bip39',
      });
      if (wallet.address !== fromAddress) throw new Error('Derived signer address mismatch.');
      const signed = wallet.sign(payment as never);
      if (!/^[A-F0-9]+$/u.test(signed.tx_blob) || !wallet.verifyTransaction(signed.tx_blob)) {
        throw new Error('XRPL transaction signature verification failed.');
      }
      return signed.tx_blob;
    });
  }

  async signEvmNativeTransactionForAddress(
    fromAddress: string,
    transaction: EvmNativeTransactionToSign,
  ): Promise<string> {
    return this.signEvmTransactionForAddress(fromAddress, transaction);
  }

  async verifyRecovery(keyHandle: string, storeIndexes: readonly [number, number]): Promise<boolean> {
    if (storeIndexes[0] === storeIndexes[1]) return false;
    const stores = storeIndexes.map((index) => this.#stores[index]).filter(Boolean);
    if (stores.length !== 2) return false;
    const shares = await Promise.all(stores.map((store) => store!.get(keyHandle)));
    if (shares.some((share) => share === null)) return false;
    const recovered = await combine(shares as Uint8Array[]);
    try {
      const expected = this.#publicAddresses.get(keyHandle);
      const kind = this.#secretKinds.get(keyHandle);
      if (!expected || !kind) return false;
      const actual = kind === 'mnemonic-entropy'
        ? await deriveAddresses(ethers.Mnemonic.fromEntropy(recovered).phrase)
        : [{ addressGroupId: 'evm' as const, address: new ethers.Wallet(ethers.hexlify(recovered)).address }];
      return actual.length === expected.length && actual.every((address, index) => (
        address.addressGroupId === expected[index]?.addressGroupId
        && address.address === expected[index]?.address
      ));
    } finally {
      recovered.fill(0);
      for (const share of shares) share?.fill(0);
    }
  }
}
