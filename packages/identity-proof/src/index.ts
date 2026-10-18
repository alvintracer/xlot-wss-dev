import { secp256k1, hashToCurve } from '@noble/curves/secp256k1';
import { sha256 } from '@noble/hashes/sha256';

// Development-only proof of equality against an issuer-signed Pedersen
// commitment. This protocol needs independent review before production use.
const order = secp256k1.CURVE.n;
const Point = secp256k1.ProjectivePoint;
const generator = hashToCurve(new TextEncoder().encode('Took WSS identity opening generator v1')) as unknown as InstanceType<typeof Point>;
const encoder = new TextEncoder();

export interface IdentityEqualityProof {
  announcement: string;
  response: string;
}

function bytesToNumber(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) + BigInt(byte);
  return value;
}

function scalarHex(value: bigint): string { return value.toString(16).padStart(64, '0'); }
function pointMultiply(point: InstanceType<typeof Point>, scalar: bigint) {
  return scalar === 0n ? Point.ZERO : point.multiply(scalar);
}
function normalizeName(value: string): string {
  const result = value.trim().normalize('NFC');
  if (!result || result.length > 80) throw new Error('identity_name_invalid');
  return result;
}
function normalizeBirthDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('identity_birth_date_invalid');
  return value;
}
function claimScalar(name: string, birthDate: string): bigint {
  return bytesToNumber(sha256(encoder.encode(JSON.stringify([
    'took-wss-identity-name-birth-v1', normalizeName(name), normalizeBirthDate(birthDate),
  ])))) % order;
}
function randomScalar(): bigint {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const value = bytesToNumber(bytes);
    bytes.fill(0);
    if (value > 0n && value < order) return value;
  }
}
function challengeScalar(input: { credentialId: string; nonce: string; commitment: string; expectedName: string; expectedBirthDate: string; announcement: string }): bigint {
  return bytesToNumber(sha256(encoder.encode(JSON.stringify([
    'took-wss-identity-equality-proof-v1', input.credentialId, input.nonce,
    input.commitment, normalizeName(input.expectedName), normalizeBirthDate(input.expectedBirthDate), input.announcement,
  ])))) % order;
}

export function createIdentityCommitment(name: string, birthDate: string) {
  const opening = randomScalar();
  const point = pointMultiply(Point.BASE, claimScalar(name, birthDate)).add(generator.multiply(opening));
  return { commitment: point.toHex(true), opening: scalarHex(opening) };
}

export function createIdentityEqualityProof(input: {
  credentialId: string;
  nonce: string;
  commitment: string;
  opening: string;
  expectedName: string;
  expectedBirthDate: string;
}): IdentityEqualityProof {
  if (!/^[0-9a-f]{64}$/i.test(input.opening)) throw new Error('identity_opening_invalid');
  const opening = BigInt(`0x${input.opening}`);
  if (opening <= 0n || opening >= order) throw new Error('identity_opening_invalid');
  const commitment = Point.fromHex(input.commitment);
  const expectedPoint = pointMultiply(Point.BASE, claimScalar(input.expectedName, input.expectedBirthDate))
    .add(generator.multiply(opening));
  if (!commitment.equals(expectedPoint)) throw new Error('identity_claims_do_not_match');
  const ephemeral = randomScalar();
  const announcement = generator.multiply(ephemeral).toHex(true);
  const challenge = challengeScalar({ ...input, announcement });
  return { announcement, response: scalarHex((ephemeral + challenge * opening) % order) };
}

export function verifyIdentityEqualityProof(input: {
  credentialId: string;
  nonce: string;
  commitment: string;
  expectedName: string;
  expectedBirthDate: string;
  proof: IdentityEqualityProof;
}): boolean {
  try {
    if (!/^[0-9a-f]{64}$/i.test(input.proof.response)) return false;
    const response = BigInt(`0x${input.proof.response}`);
    if (response >= order) return false;
    const commitment = Point.fromHex(input.commitment);
    const announcement = Point.fromHex(input.proof.announcement);
    const expected = pointMultiply(Point.BASE, claimScalar(input.expectedName, input.expectedBirthDate));
    const target = commitment.subtract(expected);
    const challenge = challengeScalar({ ...input, announcement: input.proof.announcement });
    return pointMultiply(generator, response).equals(announcement.add(pointMultiply(target, challenge)));
  } catch { return false; }
}
