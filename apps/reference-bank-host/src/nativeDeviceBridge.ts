import { Capacitor, registerPlugin } from '@capacitor/core';
import { buildBithumbBrowserBootstrap, buildExchangeRouterScript, exchangeStartUrls, isExchangeUrlAllowed, type ExchangeId, type ExchangeRouterBrand } from './exchangeRouter';
import { extractBithumbWalletConnectUri } from './bithumbWalletConnectPolicy';

type NativeRequest = {
  type: 'took-wss:native-request';
  requestId: string;
  action: 'capabilities' | 'scan-card' | 'cancel-card' | 'open-exchange' | 'save-receipt';
  exchange?: 'bithumb' | 'coinone';
  walletId?: string;
  address?: string;
  walletLabel?: string;
  filename?: string;
  data?: string;
};

type CardScan = {
  cardIdHex: string;
  algorithm?: string;
  lifecycle: string;
  publicKeyHex?: string;
  rsaModulusHex?: string;
  rsaExponentHex?: string;
  pinConfigured?: boolean;
};

const card = registerPlugin<{
  isSupported(): Promise<{ supported: boolean; enabled: boolean }>;
  scanCard(options?: { timeoutMs?: number }): Promise<CardScan>;
  cancel(): Promise<void>;
}>('TookNfcCard');

const exchanges = {
  bithumb: { name: '빗썸', host: 'bithumb.com' },
  coinone: { name: '코인원', host: 'coinone.co.kr' },
} as const;

function nativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
}

const iconCache = new Map<string, Promise<string>>();

function tenantIconDataUrl(file: string): Promise<string> {
  const url = `${window.location.origin}${import.meta.env.BASE_URL}icons/${file}`;
  const cached = iconCache.get(url);
  if (cached) return cached;
  const loading = fetch(url).then(async (response) => {
    if (!response.ok) throw new Error('Tenant icon unavailable');
    const blob = await response.blob();
    if (!blob.type.startsWith('image/') || blob.size > 300_000) throw new Error('Tenant icon format unavailable');
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Tenant icon read failed'));
      reader.readAsDataURL(blob);
    });
  }).catch(() => url);
  iconCache.set(url, loading);
  return loading;
}

export interface ExchangePersonalSignRequest { exchange: ExchangeId | 'identity'; walletId: string; address: string; message: string }

async function openExchange(exchangeId: ExchangeId, walletId: string, address: string, walletLabel: string,
  brand: ExchangeRouterBrand, onPersonalSign?: (request: ExchangePersonalSignRequest) => Promise<string>): Promise<void> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('연결할 EVM 월렛 주소가 없어요.');
  const { BackgroundColor, InAppBrowser, ToolBarType } = await import('@capgo/inappbrowser');
  const exchange = exchanges[exchangeId];
  const startUrl = exchangeStartUrls[exchangeId];
  const walletConnect = exchangeId === 'bithumb' ? new (await import('./bithumbWalletConnect')).BithumbWalletConnect(
    import.meta.env.VITE_WSS_WALLETCONNECT_PROJECT_ID ?? '',
  ) : null;
  const guide = buildExchangeRouterScript({
    exchange: exchangeId, exchangeName: exchange.name, allowedHost: exchange.host,
    address, walletLabel: walletLabel.slice(0, 40), brandName: brand.name,
    brandIcon: await tenantIconDataUrl(brand.iconFile), color: brand.color,
    ink: brand.ink, primaryInk: brand.primaryInk, fontFamily: brand.fontFamily,
  });
  let currentUrl: string = startUrl;
  let browserId: string | undefined;
  let lastWcUri = '';
  const showWcStatus = (message: string) => {
    if (!browserId) return;
    void InAppBrowser.executeScript({ id: browserId,
      code: `window.dispatchEvent(new CustomEvent('took-wss:bithumb-wc-status',{detail:${JSON.stringify({ message })}}))`,
    }).catch(() => undefined);
  };
  const pairBithumb = (raw: string) => {
    const uri = extractBithumbWalletConnectUri(raw);
    if (!uri || uri === lastWcUri || !walletConnect || !onPersonalSign) return;
    lastWcUri = uri;
    showWcStatus(`${brand.name} 월렛에서 지갑을 연결하고 있어요.`);
    void walletConnect.pair(uri, walletId, address, async (request) => {
      if (!browserId) throw new Error('빗썸 화면이 닫혔어요.');
      const signing = onPersonalSign({ exchange: 'bithumb', ...request });
      void signing.catch(() => undefined);
      await InAppBrowser.hide({ id: browserId });
      try {
        const signature = await signing;
        await InAppBrowser.executeScript({ id: browserId,
          code: "window.dispatchEvent(new Event('took-wss:exchange-router-complete'))",
        }).catch(() => undefined);
        return signature;
      } finally { await InAppBrowser.show({ id: browserId }).catch(() => undefined); }
    }).then(
      () => showWcStatus('빗썸의 서명 요청을 기다리고 있어요.'),
      (error: unknown) => showWcStatus(error instanceof Error ? error.message : '지갑 연결을 완료하지 못했어요.'),
    );
  };
  const listeners = [
    await InAppBrowser.addListener('browserPageLoaded', (event) => {
      if (isExchangeUrlAllowed(currentUrl, exchange.host)) {
        void InAppBrowser.executeScript({ code: guide, id: event.id }).catch(() => undefined);
      }
    }),
    await InAppBrowser.addListener('urlChangeEvent', (event) => {
      if (exchangeId === 'bithumb' && extractBithumbWalletConnectUri(event.url)) {
        pairBithumb(event.url);
        return;
      }
      currentUrl = event.url;
      if (isExchangeUrlAllowed(event.url, exchange.host)) {
        void InAppBrowser.executeScript({ code: guide, id: event.id }).catch(() => undefined);
      }
    }),
    await InAppBrowser.addListener('messageFromWebview', (event) => {
      if (!onPersonalSign || !browserId || event.id !== browserId
        || !isExchangeUrlAllowed(currentUrl, exchange.host)) return;
      let value: unknown;
      try { value = JSON.parse(String(event.detail?.message ?? event.rawMessage ?? '')); } catch { return; }
      if (!value || typeof value !== 'object') return;
      const request = value as Record<string, unknown>;
      if (exchangeId === 'bithumb') {
        if (new URL(currentUrl).pathname.startsWith('/uhw/kyw/')
          && request.type === 'took-wss:bithumb-wc-uri' && typeof request.uri === 'string') pairBithumb(request.uri);
        return;
      }
      if (exchangeId !== 'coinone'
        || !new URL(currentUrl).pathname.includes('/balance/transfer/withdrawal-address')) return;
      if (request.type !== 'took-wss:coinone-personal-sign'
        || typeof request.requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(request.requestId)
        || request.address !== address || typeof request.message !== 'string'
        || request.message.length > 8192) return;
      const requestId = request.requestId;
      void (async () => {
        try {
          const signing = onPersonalSign({ exchange: 'coinone', walletId, address, message: request.message as string });
          void signing.catch(() => undefined);
          await InAppBrowser.hide({ id: browserId });
          const signature = await signing;
          await InAppBrowser.executeScript({ id: browserId, code: `window.dispatchEvent(new Event('took-wss:exchange-router-complete'));window.dispatchEvent(new CustomEvent('took-wss:coinone-rpc-result',{detail:${JSON.stringify({ requestId, result: signature })}}))` });
        } catch (error) {
          const message = error instanceof Error ? error.message : '서명을 완료하지 못했어요.';
          await InAppBrowser.executeScript({ id: browserId, code: `window.dispatchEvent(new CustomEvent('took-wss:coinone-rpc-result',{detail:${JSON.stringify({ requestId, error: message })}}))` }).catch(() => undefined);
        } finally { await InAppBrowser.show({ id: browserId }).catch(() => undefined); }
      })();
    }),
  ];
  const closeListener = await InAppBrowser.addListener('closeEvent', () => {
    void walletConnect?.close();
    for (const listener of listeners) void listener.remove();
    void closeListener.remove();
  });
  try {
    const opened = await InAppBrowser.openWebView({
      url: startUrl,
      ...(exchangeId === 'coinone' ? { headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      } } : {}),
      title: exchange.name,
      toolbarType: ToolBarType.NAVIGATION,
      backgroundColor: BackgroundColor.WHITE,
      showReloadButton: true,
      isPresentAfterPageLoad: true,
      preShowScript: exchangeId === 'bithumb' ? buildBithumbBrowserBootstrap() : guide,
      ...(exchangeId === 'bithumb' ? {
        preShowScriptInjectionTime: 'documentStart' as const,
        preventDeeplink: true,
        blockedHosts: ['metamask.app.link'],
      } : {}),
    });
    browserId = opened.id;
    if (isExchangeUrlAllowed(currentUrl, exchange.host)) {
      void InAppBrowser.executeScript({ code: guide }).catch(() => undefined);
    }
  } catch (error) {
    for (const listener of listeners) void listener.remove();
    void closeListener.remove();
    throw error;
  }
}

export function isNativeDeviceRequest(value: unknown): value is NativeRequest {
  if (!value || typeof value !== 'object') return false;
  const request = value as Partial<NativeRequest>;
  return request.type === 'took-wss:native-request'
    && typeof request.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(request.requestId)
    && (request.action === 'capabilities' || request.action === 'scan-card' || request.action === 'cancel-card' || request.action === 'open-exchange' || request.action === 'save-receipt');
}

export function isTrustedNativeDeviceRequest(event: MessageEvent, walletWindow: Window | null, walletOrigin: string): event is MessageEvent<NativeRequest> {
  return event.source === walletWindow && event.origin === walletOrigin && isNativeDeviceRequest(event.data);
}

export async function handleNativeDeviceRequest(request: NativeRequest, brand: ExchangeRouterBrand,
  onPersonalSign?: (request: ExchangePersonalSignRequest) => Promise<string>): Promise<unknown> {
  if (request.action === 'capabilities') {
    if (!nativeAndroid()) return { android: false, nfc: false, inAppBrowser: false };
    const support = await card.isSupported();
    return { android: true, nfc: support.supported && support.enabled, inAppBrowser: true };
  }
  if (!nativeAndroid()) throw new Error('Android 앱에서 이용할 수 있어요.');
  if (request.action === 'scan-card') {
    const scanned = await card.scanCard({ timeoutMs: 30_000 });
    if (!/^[0-9a-f]{32}$/i.test(scanned.cardIdHex)) throw new Error('카드 정보를 확인할 수 없어요.');
    return scanned;
  }
  if (request.action === 'cancel-card') { await card.cancel(); return { cancelled: true }; }
  if (request.action === 'save-receipt') {
    if (!request.filename || !/^wss-payment-[0-9a-f-]{36}\.png$/i.test(request.filename)
      || !request.data || request.data.length > 2_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(request.data)) {
      throw new Error('영수증 이미지 형식을 확인할 수 없어요.');
    }
    const { Directory, Filesystem } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const saved = await Filesystem.writeFile({ path: request.filename, data: request.data.slice('data:image/png;base64,'.length), directory: Directory.Cache });
    await Share.share({ title: '월렛 결제 영수증', text: '월렛 결제 확인 자료', files: [saved.uri], dialogTitle: '영수증 이미지 저장 또는 공유' });
    return { shared: true };
  }
  if (request.exchange !== 'bithumb' && request.exchange !== 'coinone') throw new Error('지원하지 않는 거래소예요.');
  if (!request.walletId || !/^[a-zA-Z0-9._:-]{3,128}$/.test(request.walletId)) throw new Error('월렛 정보를 확인할 수 없어요.');
  await openExchange(request.exchange, request.walletId, request.address ?? '', request.walletLabel?.trim() || brand.name, brand, onPersonalSign);
  return { opened: true };
}
