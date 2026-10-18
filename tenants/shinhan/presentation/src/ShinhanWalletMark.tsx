import { CubeTransparent } from '@phosphor-icons/react';
import type { WalletProfileSummary } from '@took-wss/contracts';

const bankMark = new URL('../assets/preview/bank-mark-preview.png', import.meta.url).href;

export function ShinhanWalletMark({ wallet }: { wallet: WalletProfileSummary }) {
  return <span className="shinhan-wallet-mark" data-origin={wallet.origin} aria-hidden="true">
    {wallet.origin === 'imported'
      ? <CubeTransparent size={20} weight="duotone" />
      : <img src={bankMark} alt="" />}
  </span>;
}
