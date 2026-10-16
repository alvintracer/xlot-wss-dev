import type { WalletPaymentRequest } from '@took-wss/contracts';
import { formatAtomic } from './WalletActionSheet';

export interface PaymentReceiptDetails {
  title: string;
  amount: string;
  rows: Array<[string, string]>;
  note: string;
}

export function paymentReceiptDetails(payment: WalletPaymentRequest, direction: 'sent' | 'received', walletLabel?: string): PaymentReceiptDetails {
  if (payment.status !== 'confirmed') throw new Error('payment_not_confirmed');
  return {
    title: direction === 'sent' ? '결제 완료 내역' : '결제 수령 내역',
    amount: `${formatAtomic(BigInt(payment.amountAtomic), payment.decimals, payment.decimals)} ${payment.assetSymbol}`,
    rows: [
      ['결제 방식', 'QR'],
      ...(walletLabel ? [['월렛', walletLabel] as [string, string]] : []),
      ['결제 완료', new Date(payment.confirmedAt ?? payment.createdAt).toLocaleString('ko-KR', {
        year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      })],
      ['네트워크', payment.chainId],
      ...(payment.referenceAmountKrw ? [['원화 참고액', `${BigInt(payment.referenceAmountKrw).toLocaleString('ko-KR')}원`] as [string, string]] : []),
      ['받는 주소', payment.recipientAddress],
      ['거래 해시', payment.transactionHash ?? '확인 중'],
      ['결제 요청 ID', payment.id],
    ],
    note: '월렛 결제 확인 자료 · 원화는 요청 시점 참고액입니다. 현금영수증이나 세금계산서가 아닙니다.',
  };
}

export async function downloadPaymentReceiptPng(payment: WalletPaymentRequest, direction: 'sent' | 'received', walletLabel?: string): Promise<void> {
  const details = paymentReceiptDetails(payment, direction, walletLabel);
  const canvas = document.createElement('canvas');
  const width = 780;
  const left = 64;
  const right = width - left;
  const rowLines = details.rows.map(([label, value]) => ({ label, lines: value.length > 22 ? value.match(/.{1,22}/g) ?? [value] : [value] }));
  canvas.width = width;
  canvas.height = 420 + rowLines.reduce((height, row) => height + 65 + (row.lines.length - 1) * 32, 0) + 145;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('receipt_image_unavailable');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#22272b';
  context.font = 'bold 37px sans-serif';
  context.fillText(details.title, left, 112);
  context.font = 'bold 50px sans-serif';
  context.fillText(details.amount, left, 205);
  context.fillStyle = '#59636b';
  context.font = '26px sans-serif';
  context.fillText('결제 확인', left, 260);
  context.strokeStyle = '#d9dfe2';
  context.beginPath(); context.moveTo(left, 304); context.lineTo(right, 304); context.stroke();
  let y = 355;
  rowLines.forEach(({ label, lines }) => {
    context.fillStyle = '#647079'; context.font = '22px sans-serif'; context.fillText(label, left, y);
    context.fillStyle = '#22272b'; context.font = valueFont(label);
    lines.forEach((line, index) => context.fillText(line, left + 230, y + index * 32));
    y += 65 + (lines.length - 1) * 32;
  });
  context.beginPath(); context.moveTo(left, y + 7); context.lineTo(right, y + 7); context.stroke();
  context.fillStyle = '#647079'; context.font = '21px sans-serif';
  context.fillText('월렛 결제 확인 자료', left, y + 59);
  context.fillText('원화는 QR 요청 시점 참고액입니다.', left, y + 90);
  context.fillText('현금영수증이나 세금계산서가 아닙니다.', left, y + 121);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('receipt_image_unavailable');
  const filename = `wss-payment-${payment.id}.png`;
  const capacitor = (window as Window & { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  if (window.parent !== window && capacitor?.isNativePlatform?.()) {
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('receipt_image_unavailable'));
      reader.readAsDataURL(blob);
    });
    const requestId = crypto.randomUUID();
    const targetOrigin = document.referrer ? new URL(document.referrer).origin : window.location.origin;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { window.removeEventListener('message', onReply); reject(new Error('receipt_share_timeout')); }, 90_000);
      const onReply = (event: MessageEvent) => {
        if (event.source !== window.parent || event.origin !== targetOrigin || event.data?.type !== 'took-wss:native-result' || event.data.requestId !== requestId) return;
        window.clearTimeout(timer); window.removeEventListener('message', onReply);
        event.data.ok ? resolve() : reject(new Error('receipt_share_failed'));
      };
      window.addEventListener('message', onReply);
      window.parent.postMessage({ type: 'took-wss:native-request', requestId, action: 'save-receipt', filename, data }, targetOrigin);
    });
    return;
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url; anchor.download = filename;
  document.body.append(anchor); anchor.click(); anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function valueFont(label: string): string {
  return label === '받는 주소' || label === '거래 해시' || label === '결제 요청 ID'
    ? '20px monospace' : 'bold 23px sans-serif';
}
