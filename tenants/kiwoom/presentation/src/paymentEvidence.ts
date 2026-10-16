import type { WalletPaymentRequest } from '@took-wss/contracts';
import { formatAtomic } from './WalletActionSheet';

const columns = [
  '결제확정일시(ISO)', '결제요청일시(ISO)', '상태', '월렛', '월렛 ID', '결제요청 ID',
  '체인', '자산', '자산 수량', '요청 시점 원화 참고액', '요청 시점 원/토큰 참고가',
  '시세 기준일시(ISO)', '받는 주소', 'TX Hash', '기록 출처',
];

function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function serializePaymentEvidenceCsv(
  payments: WalletPaymentRequest[],
  walletLabels: Record<string, string>,
): string {
  const rows = payments.filter((item) => item.status === 'confirmed').map((item) => [
    item.confirmedAt ?? '', item.createdAt, '확정', walletLabels[item.walletId] ?? '',
    item.walletId, item.id, item.chainId, item.assetSymbol,
    formatAtomic(BigInt(item.amountAtomic), item.decimals, item.decimals),
    item.referenceAmountKrw ?? '', item.referencePriceKrw ?? '', item.referencePriceAsOf ?? '',
    item.recipientAddress, item.transactionHash ?? '', 'WSS_QR_PAYMENT',
  ]);
  return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function downloadPaymentEvidenceCsv(
  payments: WalletPaymentRequest[],
  walletLabels: Record<string, string>,
  filename: string,
): void {
  const blob = new Blob([`\uFEFF${serializePaymentEvidenceCsv(payments, walletLabels)}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
