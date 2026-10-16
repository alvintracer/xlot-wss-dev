export const jbWalletUiContract = {
  profileId: 'jb-mobile-wallet-v1',
  hostOwns: ['root-header', 'account-card-wallet-tabs', 'bottom-navigation', 'safe-area', 'secure-input'],
  walletOwns: ['wallet-home', 'wallet-flows', 'wallet-sheets'],
  rootEntry: 'host-tabs',
  focusedFlow: 'hide-host-chrome',
  walletTab: '내 지갑',
} as const;
