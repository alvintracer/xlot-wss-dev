import { randomUUID } from 'node:crypto';
import { createIdentityCommitment, createIdentityEqualityProof, verifyIdentityEqualityProof } from '../src/index.js';

const name = '테스트사용자';
const birthDate = '1990-04-18';
const nonce = randomUUID();
const { commitment, opening } = createIdentityCommitment(name, birthDate);
const credentialId = randomUUID();
const proof = await createIdentityEqualityProof({ credentialId, nonce, commitment, opening, expectedName: name, expectedBirthDate: birthDate });
if (JSON.stringify(proof).includes(name) || JSON.stringify(proof).includes(birthDate)) {
  throw new Error('private_claim_disclosed_by_proof');
}
const input = { credentialId, nonce, commitment, expectedName: name, expectedBirthDate: birthDate, proof };
if (!await verifyIdentityEqualityProof(input)) throw new Error('valid_zk_proof_rejected');
if (await verifyIdentityEqualityProof({ ...input, nonce: randomUUID() })) throw new Error('different_challenge_accepted');
if (await verifyIdentityEqualityProof({ ...input, expectedName: '다른사람' })) throw new Error('different_name_accepted');
if (await verifyIdentityEqualityProof({ ...input, expectedBirthDate: '1991-04-18' })) throw new Error('different_birth_date_accepted');
const tampered = { ...proof, proof: `${proof.proof.slice(0, -2)}AA` };
if (await verifyIdentityEqualityProof({ ...input, proof: tampered })) throw new Error('modified_proof_accepted');
console.log('Noir/UltraHonk identity proof accepted; challenge, name, birth-date, and proof tampering rejected.');
