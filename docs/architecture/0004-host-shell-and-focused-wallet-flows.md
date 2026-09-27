# ADR-0004: Keep host navigation at wallet root and isolate focused wallet flows

Status: Accepted

## Decision

WSS uses a hybrid shell policy for embedded financial-app WebViews:

- The wallet root remains inside the institution's existing header and bottom navigation.
- Focused wallet flows hide host chrome and use a WSS-owned flow header with back or close controls.
- WSS does not add a second wallet bottom tab bar.
- WSS does not show a permanent hamburger menu by default.

Kiwoom starts with `host-tabs` at root, `hide-host-chrome` for focused flows, and `none` for the wallet menu.

## Why

A second bottom bar creates two competing navigation hierarchies inside one app. Keeping the host bar at root preserves the customer's location in the financial app, while hiding it during provisioning, recovery, send, and receive prevents an accidental exit from a security-sensitive sequence. A permanent hamburger would duplicate navigation before WSS has enough independent destinations to justify it.

## Contract

The tenant manifest owns three independent choices:

| Field | Options | Purpose |
| --- | --- | --- |
| `rootEntry` | `host-tabs`, `wallet-tabs`, `direct` | Defines the root navigation owner. |
| `focusedFlow` | `hide-host-chrome`, `keep-host-chrome` | Defines host chrome behavior during a focused flow. |
| `walletMenu` | `none`, `hamburger` | Enables an additional wallet-level menu only when a product needs it. |

The wallet publishes `root` or `focus` shell mode through the versioned bridge. The host decides how its chrome responds according to the signed manifest. Shared runtime and domain code do not branch on an institution ID.

## Focused flows

The initial focused-flow set is:

- wallet creation and key-adapter selection;
- institution step-up authentication;
- seed-phrase and SAR setup ceremonies;
- wallet recovery;
- receive network/address selection;
- send, quote, KYT, approval, and receipt.

Closing or completing a focused flow returns shell mode to `root`. Host authentication is requested over the bridge; WSS does not imitate a production institution authentication SDK.

## Future changes

An institution can keep its host chrome during flows or enable a hamburger by issuing a new manifest policy. The screen state machine and wallet domain contracts remain unchanged. A wallet-owned bottom bar is reserved for a future product with multiple persistent wallet destinations and should not be introduced merely to mirror the consumer app.

## Security and preview boundary

The Reference Host may auto-complete authentication only in local development. Secure import is fail-closed until an approved host-only input surface exists. ADR-0005 adds real new-SAR derivation and recovery math to the development host while keeping secrets out of WSS/BFF; the volatile share stores remain non-production. K-VWAP valuation, quotes, KYT, approvals, and execution still require production adapters.
