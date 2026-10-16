import type { PhysicalCardInfo } from '@took-wss/contracts';

type NativeAction = 'capabilities' | 'scan-card' | 'cancel-card' | 'open-exchange';

function hostOrigin(): string {
  try { return document.referrer ? new URL(document.referrer).origin : window.location.origin; }
  catch { return window.location.origin; }
}

function requestNative<T>(action: NativeAction, detail: Record<string, string> = {}, timeoutMs = 35_000): Promise<T> {
  const requestId = crypto.randomUUID();
  const targetOrigin = hostOrigin();
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('앱 응답이 지연되고 있어요. 다시 시도해 주세요.'));
    }, timeoutMs);
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== targetOrigin || event.data?.type !== 'took-wss:native-result'
        || event.data.requestId !== requestId) return;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      if (event.data.ok) resolve(event.data.result as T);
      else reject(new Error(typeof event.data.error === 'string' ? event.data.error : '기기 기능을 실행하지 못했어요.'));
    };
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'took-wss:native-request', requestId, action, ...detail }, targetOrigin);
  });
}

export async function scanPhysicalCard(): Promise<PhysicalCardInfo | null> {
  const capabilities = await requestNative<{ android: boolean; nfc: boolean }>('capabilities', {}, 3_000);
  if (!capabilities.android) return null;
  if (!capabilities.nfc) throw new Error('NFC가 꺼져 있거나 지원되지 않아요. 기기 설정을 확인해 주세요.');
  const card = await requestNative<PhysicalCardInfo>('scan-card');
  if (card.lifecycle !== 'KEY_READY' || !card.pinConfigured) throw new Error('사용 준비가 끝난 카드를 태그해 주세요.');
  return card;
}

export async function cancelPhysicalCardScan(): Promise<void> {
  await requestNative('cancel-card', {}, 3_000);
}

export async function openNativeExchange(exchange: 'bithumb' | 'coinone', walletId: string, address: string, walletLabel: string): Promise<void> {
  await requestNative<{ opened: boolean }>('open-exchange', { exchange, walletId, address, walletLabel }, 45_000);
}
