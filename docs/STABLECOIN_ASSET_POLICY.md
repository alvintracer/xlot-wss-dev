# Stablecoin asset policy

- Updated: 2026-09-27
- Scope: reusable WSS asset registry and tenant-selectable policy
- Source of truth: `services/institution-bff/src/stablecoinRegistry.ts`

## Policy model

Each tenant selects stablecoin symbols through `manifest.assetPolicy.stablecoins`.
WSS then intersects that list with the tenant's enabled chains and the curated
mainnet registry. Asset IDs include the chain, token transport, and contract or
issuer identity, so the same symbol on two networks is never treated as one
transfer asset.

Issuer-native deployments are marked `canonical: true`. A widely used bridge
or exchange-wrapped asset may be included only when its customer-facing name
states that distinction and `canonical` is false. A symbol match alone is never
sufficient to authorize a token contract for transfer.

## Kiwoom development inventory

| Asset | Enabled mainnet deployments |
| --- | --- |
| USDC | Ethereum, Polygon, Arbitrum, Base, BNB Chain (Binance-Peg), Solana, XRP Ledger |
| USDT | Ethereum, Polygon (bridge), Arbitrum (bridge), BNB Chain (Binance-Peg), Solana, TRON |
| RLUSD | Ethereum, Base, XRP Ledger |
| EURC | Ethereum, Base, Solana |
| JPYC | Ethereum, Polygon |
| PYUSD | Ethereum, Polygon, Arbitrum, Solana |
| USDG | Ethereum, Arbitrum, Solana |
| DAI | Ethereum |
| USDS | Ethereum |
| FDUSD | Ethereum, Arbitrum, BNB Chain, Solana |
| USDP | Ethereum |
| GUSD | Ethereum |
| XUSD | Ethereum, BNB Chain, Solana |
| XSGD | Ethereum, Polygon, Arbitrum, Base, Solana, XRP Ledger |

This is 14 stablecoin symbols and 45 chain-specific deployments. Contract,
mint, issuer, decimals, transport, and canonical status are held in the shared
registry; tenant manifests contain symbols rather than duplicated addresses.

## Current capability levels

- Balance discovery: native and configured stablecoin balances are queried on
  EVM networks, Solana, TRON, and XRP Ledger. Bitcoin remains native-only.
- Receive: every policy-enabled deployment appears in the asset/network picker
  even when its balance is zero, and its registered wallet address is rendered
  as the QR payload.
- Send: configured EVM ERC-20 assets support amount validation, token-contract
  allowlisting, gas estimation, fail-closed KYT, host confirmation, SAR signing,
  exact signed-payload verification, and broadcast.
- Non-EVM token send: Solana SPL, TRON TRC-20, and XRP issued-currency signing
  and broadcast remain unavailable until their host signers are implemented.
- Fee abstraction: permit-relay eligibility may be quoted, but the direct
  ERC-20 path still requires the wallet to hold the network's native gas asset.
  The UI must not say sponsorship was applied until relay execution is used.
- XRP Ledger: receiving an issued asset such as RLUSD, USDC, or XSGD requires
  an appropriate trust line. The receive screen calls this out; trust-line
  creation is not yet automated.

## Address authorities

- Circle USDC/EURC: <https://developers.circle.com/stablecoins/usdc-contract-addresses>
- Ripple RLUSD: <https://docs.ripple.com/products/stablecoin/overview/token-addresses>
- Tether: <https://tether.to/en/supported-protocols/>
- Paxos stablecoins: <https://docs.paxos.com/guides/stablecoin>
- JPYC: <https://github.com/jpycoin>
- First Digital USD: <https://www.firstdigitallabs.com/fdusd>
- StraitsX XSGD/XUSD: <https://www.straitsx.com/xsgd> and <https://www.straitsx.com/xusd>

Before adding or changing a deployment, verify it against the issuer's current
mainnet documentation and, where possible, read `symbol` and `decimals` from
the live contract. Registry changes require uniqueness, tenant-filter, and
transport tests. Production must additionally define issuer-risk, liquidity,
travel-rule, sanctions, depeg, pause/freeze, and delisting policy per asset.
