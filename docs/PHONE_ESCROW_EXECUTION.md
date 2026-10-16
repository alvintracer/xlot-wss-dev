# WSS phone escrow execution

- Updated: 2026-10-10
- Scope: reusable WSS sender/recipient execution and Kiwoom, JB, Namu customer presentation
- Status: sender, claimant OTP/KYT, dedicated claim signer relay, and sender refund paths implemented; deployment policy supports four USDC networks and three native ETH networks with separate payout caps

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
6. The sender can share the same claim link from the result or activity list,
   and can retry a failed SMS from either place. Retry is limited to five
   attempts with a 60-second cooldown and is available only to the sending
   customer while the deposit is funded and unexpired.
7. The public claim page accepts a manually entered EVM address or an address
   from an injected wallet. The recipient verifies the matching phone number
   and OTP; the claim page polls through chain confirmation and links the
   confirmed transaction to a network explorer.

Before the sender confirms a phone recipient, the wallet reads the live V3 fee
policy and shows the requested payout, claim fee, and total escrow debit. It
also computes the maximum payout permitted by the available asset balance and
the current pilot cap. Final preparation rechecks all figures on the server.

## Supported sender assets and limits

The current V3 escrow deployment catalog covers Ethereum, Polygon, Arbitrum,
and Base. The production allowlist permits canonical Circle USDC on all four,
up to **100 USDC payout** per transfer. Native ETH is permitted on Ethereum,
Arbitrum, and Base, up to **0.1 ETH payout** per transfer. Native POL is
permitted on Polygon, up to **100 POL payout** per transfer. The sender
also pays the live V3 claim fee and network gas in addition to the requested
payout. Other tokens and networks remain disabled.

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

## Shared signer and separate claim surface decision

The existing took V3 escrow contracts and public claim-signer address are
reused, while WSS owns a separate claimant surface at
`https://took-wss.vercel.app/c/{claimCode}`. Claim records remain solely in
`xlot-wss-dev.wss_phone_escrows`; they are not copied into the took B2C
`phone_escrows` table.

The WSS claimant service resolves the code server-side, verifies phone
possession with WSS Supabase Auth/SOLAPI, screens the recipient address, and
calls a dedicated authenticated signer relay in Took Pay. The relay verifies
the exact onchain deposit, signer, token, amount, expiry, and minimum payout
before broadcasting. The claim signer's private key stays only in Took Pay.
The sender can request a refund after expiry through a separate host-approved
wallet signature. WSS reconciles claim and refund receipts by their events.
If the relay response is lost after broadcast, WSS records the starting block
and scans bounded `Claimed` event ranges for that commitment and recipient to
recover the transaction hash and payout instead of leaving the claim in an
indefinite processing state.

The `took-wss.vercel.app/c` path is a development and proposal-stage hosting
location, separated from the took consumer domain. Its UI is tenant-neutral and does not render the took consumer brand.
A financial institution can later map the same claimant surface to its own
domain without changing the escrow contracts, commitments, or signer address.

## Activation gate

Sending real funds is deliberately disabled unless
`WSS_PHONE_ESCROW_EXECUTION_ENABLED=true`, `WSS_PHONE_CLAIM_BASE_URL`, and
`WSS_PHONE_ESCROW_CLAIM_SIGNER_ADDRESS` are present. The URL must point to the
WSS recipient flow, and its claim resolver, phone verification, recipient KYT,
and authenticated took signer relay must all be operational before a deposit
can be prepared.
`WSS_PHONE_ESCROW_ALLOWED_ASSET_IDS` must explicitly list each enabled asset
in production. Code policy independently permits only the eight pairs above;
their distinct atomic-unit caps are 100,000,000 for USDC,
100,000,000,000,000,000 for ETH, and 100,000,000,000,000,000,000 for POL.
These are recipient payout caps, not total
escrow debit caps. The allowlist also controls which wallet rows show phone
transfer as available. The previous generic
`WSS_PHONE_ESCROW_MAX_RECIPIENT_ATOMIC` setting is no longer used.
Before preparing a deposit, the BFF reads `serverSigner()` from the selected
contract and requires an exact match with the configured signer address.

This gate is not cosmetic. Reusing an existing contract without its matching
claim signer could lock customer funds until expiry. A Base mainnet fork
verified a real USDC deposit and expiry refund against the deployed escrow
without spending real funds. A Base mainnet fork also verified native ETH
deposit and expiry refund without spending real funds. On 2026-10-10,
read-only checks found identical V3 contract code hashes and the expected
server signer on all four networks, and the claim relay reported a matching
signer on all four. A Polygon mainnet fork verified POL deposit and expiry
refund without spending real funds. A funded recipient OTP and claim for
each newly enabled asset and network remains unverified; a failed claim may
require waiting until expiry to refund. Signer checks do not replace those
funded tests or prove relay gas balance.

## Operational follow-up

- Add a server-side retry worker for `sms_status IN ('pending', 'failed')`.
- Exercise claim and refund reconciliation with funded low-value transfers.
- Record contract code hash, signer address, treasury, and fee policy for each
  configured deployment before enabling a tenant.
- Run funded testnet/mainnet smoke tests with an authorized handset and a
  disposable low-value wallet before a tenant demo uses real value.

## Comparison with the original took phone flow

The existing V3 deployments and signer are shared, but WSS has its own claim
records, institution session, SMS branding, sender authorization, and claim
page. Sender quote, deposit, confirmation, SMS/link delivery, recipient OTP,
KYT, claim, status, and expiry refund are connected. Automated verification
does not substitute for a funded end-to-end claim and refund on production.

One original sender experience remains outside the current production pilot;
the institution recipient path below is now implemented for the preview apps:

- Original USDC permit relay deposits are gasless to the sender. V3 records
  `msg.sender` as the refundable depositor, so a relayed deposit gives the
  relay the refund right. Reusing the original route without a matching
  authenticated refund relay would make the WSS sender unable to refund.
  WSS therefore uses a customer-signed onchain deposit and requires native
  network gas. This needs an explicit relay/refund design before parity.
- The WSS public claim page links to the Kiwoom, JB, and Namu app routes. The
  recipient's selected institution creates its own short-lived host session;
  the wallet app checks the customer's registered, phone-verified identity,
  then lets them choose an existing wallet or complete the existing wallet
  creation flow. A second phone OTP verifies the SMS recipient. The server
  resolves the chosen wallet's receive address from the authenticated profile
  and the claim network before calling the shared claim relay. The browser
  never supplies an arbitrary institution wallet address. The public external
  address option remains available separately.
- The current installed app routes are explicit development preview hosts.
  Real institution customer authentication requires each institution to supply
  its signed short-lived production host session. A browser-generated preview
  session is not a bank login.

The four EVM deployment addresses are configured in code. Production asset
availability is governed by the explicit environment allowlist and the code
policy above. Funded end-to-end claim tests are still needed to establish
operational confidence for each newly enabled pair.
