# WSS phone escrow execution

- Updated: 2026-09-28
- Scope: reusable WSS sender execution and Kiwoom customer presentation
- Status: sender path implemented; activation is fail-closed until a matching WSS claim service is configured

## Customer flow

1. The customer selects an asset and network, enters an amount, then chooses
   `휴대폰 번호로 보내기`.
2. WSS normalizes a Korean mobile number, reads the live contract fee policy,
   and prepares a sender-pays quote so the recipient receives exactly the
   entered asset amount.
3. The host security surface authorizes once. A native-asset deposit signs one
   transaction; an ERC-20 deposit signs the required allowance transaction(s)
   and deposit as one ordered batch.
4. The BFF verifies every signed field against the prepared payload, broadcasts
   in nonce order, waits for confirmation, and verifies the matching `Deposited`
   event before notifying the recipient.
5. SOLAPI sends a tenant-branded claim link. No customer-facing message or
   screen exposes the internal took brand.

## Supported sender networks

The current V3 escrow deployment catalog covers Ethereum, Polygon, Arbitrum,
and Base. Native assets and allowlisted ERC-20 assets on those networks can use
the sender path. BNB Chain, Solana, TRON, XRP Ledger, and Bitcoin remain
disabled until a compatible escrow deployment and claim policy exist.

## Data and signing boundary

- The generic transfer audit stores a one-way tenant-bound recipient reference,
  never a phone number.
- `wss_phone_escrows` stores the recipient number only as an AES-256-GCM
  envelope plus a tenant-bound HMAC lookup. The ciphertext is purged after a
  successful notification.
- Claim codes, commitments, contract addresses, amounts, provider delivery
  state, and public transaction hashes are operational metadata.
- Seeds, private keys, raw signatures, raw signed transactions, OTP plaintext,
  and claim-signer keys are never persisted in these tables.
- Phone delivery occurs only after a successful receipt and commitment match;
  an SMS failure never changes a failed chain transaction into a success.

## Activation gate

Sending real funds is deliberately disabled unless
`WSS_PHONE_ESCROW_EXECUTION_ENABLED=true`, `WSS_PHONE_CLAIM_BASE_URL`, and
`WSS_PHONE_ESCROW_CLAIM_SIGNER_ADDRESS` are present. The URL must point to a
WSS-owned recipient flow whose authorization service controls that signer.
Before preparing a deposit, the BFF reads `serverSigner()` from the selected
contract and requires an exact match with the configured signer address.

This gate is not cosmetic. Reusing an existing contract without its matching
claim signer could lock customer funds until expiry. The current
`xlot-wss-dev` environment therefore keeps the customer action unavailable
until the WSS claim gateway, recipient phone possession check, recipient-wallet
KYT, claim relay/refund path, and matching signer secret are deployed and smoke
tested together.

## Operational follow-up

- Add a server-side retry worker for `sms_status IN ('pending', 'failed')`.
- Add claim/refund reconciliation and durable resume after BFF restart.
- Record contract code hash, signer address, treasury, and fee policy for each
  configured deployment before enabling a tenant.
- Run funded testnet/mainnet smoke tests with an authorized handset and a
  disposable low-value wallet before a tenant demo uses real value.
