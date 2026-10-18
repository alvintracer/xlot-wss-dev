use std::hash::blake2s;

// Prove the issuer-signed commitment opens to the requested name digest and
// birth date. The holder's 256-bit salt never becomes a public input.
fn main(
    name_hash: [u8; 32],
    birth_date: [u8; 10],
    salt: [u8; 32],
    expected_claim_digest: pub [u8; 32],
    commitment: pub [u8; 32],
    challenge: pub [u8; 16],
) -> pub [u8; 32] {
    let mut claim = [0; 75];
    claim[0] = 1;
    for i in 0..32 { claim[i + 1] = name_hash[i]; }
    for i in 0..10 {
        claim[i + 33] = birth_date[i];
    }
    for i in 0..32 {
        claim[i + 43] = salt[i];
    }
    let digest = blake2s(claim);
    let mut expected = [0; 59];
    expected[0] = 3;
    for i in 0..32 { expected[i + 1] = name_hash[i]; }
    for i in 0..10 { expected[i + 33] = birth_date[i]; }
    for i in 0..16 { expected[i + 43] = challenge[i]; }
    let expected_digest = blake2s(expected);
    for i in 0..32 { assert(expected_digest[i] == expected_claim_digest[i]); }
    let mut binding = [0; 49];
    binding[0] = 2;
    for i in 0..32 {
        assert(digest[i] == commitment[i]);
        binding[i + 1] = digest[i];
    }
    for i in 0..16 {
        binding[i + 33] = challenge[i];
    }
    blake2s(binding)
}
