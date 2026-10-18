import { sha256 } from '@noble/hashes/sha256';
import { blake2s } from '@noble/hashes/blake2s';
import { Noir } from '@noir-lang/noir_js';
import { Barretenberg, UltraHonkBackend } from '@aztec/bb.js';
import circuit from './generated/identity_equality.json';

const encoder = new TextEncoder();
const PROOF_SCHEME = 'noir-ultrahonk-v1' as const;
const compiledCircuit = circuit as unknown as ConstructorParameters<typeof Noir>[0];

export interface IdentityEqualityProof {
  scheme: typeof PROOF_SCHEME;
  proof: string;
  publicInputs: string[];
}

function nameDigest(value: string): Uint8Array {
  const name = value.trim().normalize('NFC');
  if (!name || name.length > 80) throw new Error('identity_name_invalid');
  return sha256(encoder.encode(JSON.stringify(['took-wss-name-v2', name])));
}

function dateBytes(value: string): Uint8Array {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error('identity_birth_date_invalid');
  }
  return encoder.encode(value);
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fromHex(value: string, length: number): Uint8Array {
  if (!new RegExp(`^[0-9a-f]{${length * 2}}$`, 'i').test(value)) throw new Error('identity_opening_invalid');
  return Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16));
}

function nonceBytes(value: string): Uint8Array {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new Error('identity_challenge_invalid');
  }
  return fromHex(value.replaceAll('-', ''), 16);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}

function commitmentBytes(name: string, birthDate: string, salt: Uint8Array): Uint8Array {
  return blake2s(concat(Uint8Array.of(1), nameDigest(name), dateBytes(birthDate), salt));
}

function bindingBytes(commitment: Uint8Array, nonce: Uint8Array): Uint8Array {
  return blake2s(concat(Uint8Array.of(2), commitment, nonce));
}

function claimDigest(name: string, birthDate: string, nonce: Uint8Array): Uint8Array {
  return blake2s(concat(Uint8Array.of(3), nameDigest(name), dateBytes(birthDate), nonce));
}

function expectedPublicInputs(name: string, birthDate: string, commitment: Uint8Array, nonce: Uint8Array): bigint[] {
  return [...claimDigest(name, birthDate, nonce), ...commitment, ...nonce, ...bindingBytes(commitment, nonce)].map(BigInt);
}

function base64url(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64url');
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 100_000) throw new Error('identity_proof_invalid');
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(value, 'base64url'));
  return Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), (char) => char.charCodeAt(0));
}

export function createIdentityCommitment(name: string, birthDate: string) {
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const commitment = hex(commitmentBytes(name, birthDate, salt));
  const opening = hex(salt);
  salt.fill(0);
  return { commitment, opening };
}

export async function createIdentityEqualityProof(input: {
  credentialId: string;
  nonce: string;
  commitment: string;
  opening: string;
  expectedName: string;
  expectedBirthDate: string;
}): Promise<IdentityEqualityProof> {
  const salt = fromHex(input.opening, 32);
  const commitment = fromHex(input.commitment, 32);
  if (hex(commitmentBytes(input.expectedName, input.expectedBirthDate, salt)) !== input.commitment.toLowerCase()) {
    throw new Error('identity_claims_do_not_match');
  }
  const nameHash = nameDigest(input.expectedName);
  const birth = dateBytes(input.expectedBirthDate);
  const nonce = nonceBytes(input.nonce);
  const noir = new Noir(compiledCircuit);
  const api = await Barretenberg.new();
  const backend = new UltraHonkBackend(circuit.bytecode, api);
  try {
    const { witness } = await noir.execute({
      name_hash: [...nameHash], birth_date: [...birth], salt: [...salt],
      expected_claim_digest: [...claimDigest(input.expectedName, input.expectedBirthDate, nonce)],
      commitment: [...commitment], challenge: [...nonce],
    });
    const result = await backend.generateProof(witness);
    return { scheme: PROOF_SCHEME, proof: base64url(result.proof), publicInputs: result.publicInputs };
  } finally {
    salt.fill(0);
    await api.destroy();
  }
}

export async function verifyIdentityEqualityProof(input: {
  credentialId: string;
  nonce: string;
  commitment: string;
  expectedName: string;
  expectedBirthDate: string;
  proof: IdentityEqualityProof;
  crsPath?: string;
}): Promise<boolean> {
  try {
    if (input.proof?.scheme !== PROOF_SCHEME || !Array.isArray(input.proof.publicInputs)) return false;
    const commitment = fromHex(input.commitment, 32);
    const expected = expectedPublicInputs(input.expectedName, input.expectedBirthDate, commitment, nonceBytes(input.nonce));
    if (input.proof.publicInputs.length !== expected.length
      || input.proof.publicInputs.some((value, index) => BigInt(value) !== expected[index])) {
      console.error('identity_proof_public_inputs_mismatch');
      return false;
    }
    const api = await Barretenberg.new(input.crsPath ? { crsPath: input.crsPath } : {});
    const backend = new UltraHonkBackend(circuit.bytecode, api);
    try {
      const valid = await backend.verifyProof({ proof: fromBase64url(input.proof.proof), publicInputs: input.proof.publicInputs });
      if (!valid) console.error('identity_proof_invalid');
      return valid;
    } finally { await api.destroy(); }
  } catch (error) {
    console.error('identity_proof_verifier_unavailable', error instanceof Error ? error.message : 'unknown');
    return false;
  }
}
