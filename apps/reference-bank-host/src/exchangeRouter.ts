export type ExchangeId = 'bithumb' | 'coinone';

export interface ExchangeRouterBrand {
  name: string;
  iconFile: string;
  color: string;
  ink: string;
  primaryInk: string;
  fontFamily: string;
}

interface ExchangeRouterSettings {
  exchange: ExchangeId;
  exchangeName: string;
  allowedHost: string;
  address: string;
  walletLabel: string;
  brandName: string;
  brandIcon: string;
  color: string;
  ink: string;
  primaryInk: string;
  fontFamily: string;
}

// Coinone checks both the browser environment and the MetaMask provider when
// registering a personal wallet. Keep the desktop emulation on its address-book
// route so the rest of the exchange retains its normal mobile presentation.
function prepareCoinoneAddressBook(address: string): void {
  if (location.protocol !== 'https:' || !['coinone.co.kr', 'www.coinone.co.kr'].includes(location.hostname)) return;
  if (!location.pathname.includes('/balance/transfer/withdrawal-address')) return;
  const browser = window as Window & {
    __tookWssCoinonePrepared?: boolean;
    ethereum?: {
      isMetaMask: boolean; selectedAddress: string; chainId: string;
      request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
      on: (event: string, listener: (...args: unknown[]) => void) => unknown;
      removeListener: (event: string, listener: (...args: unknown[]) => void) => unknown;
      enable: () => Promise<unknown>;
    };
    chrome?: { runtime?: Record<string, never> };
    mobileApp?: { postMessage: (message: { detail: { message: string } }) => void };
    __tookWssCoinoneRequests?: Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>;
  };
  if (browser.__tookWssCoinonePrepared) return;
  browser.__tookWssCoinonePrepared = true;
  const desktopUa = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
  for (const [property, value] of Object.entries({
    userAgent: desktopUa, platform: 'MacIntel', vendor: 'Google Inc.', maxTouchPoints: 0,
  })) {
    try { Object.defineProperty(navigator, property, { configurable: true, get: () => value }); } catch { /* Native UA header remains desktop. */ }
  }
  try { delete (browser as Window & { ontouchstart?: unknown }).ontouchstart; } catch { /* Optional. */ }
  browser.chrome ??= {};
  browser.chrome.runtime ??= {};
  const originalMatchMedia = window.matchMedia.bind(window);
  window.matchMedia = (query: string) => {
    if (query.includes('max-width: 979') || query.includes('max-width: 639') || query.includes('pointer: coarse')) {
      return { matches: false, media: query, onchange: null, addListener() {}, removeListener() {},
        addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false };
    }
    return originalMatchMedia(query);
  };
  if (browser.ethereum) return;
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  browser.__tookWssCoinoneRequests = pending;
  window.addEventListener('took-wss:coinone-rpc-result', ((event: CustomEvent<{ requestId: string; result?: unknown; error?: string }>) => {
    const entry = pending.get(event.detail?.requestId);
    if (!entry) return;
    pending.delete(event.detail.requestId);
    if (event.detail.error) entry.reject(new Error(event.detail.error));
    else entry.resolve(event.detail.result);
  }) as EventListener);
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const emit = (event: string, value: unknown) => {
    for (const listener of listeners.get(event) ?? []) {
      try { listener(value); } catch { /* One exchange listener cannot block another. */ }
    }
  };
  const announceConnection = () => window.setTimeout(() => {
    emit('connect', { chainId: '0x1' });
    emit('accountsChanged', [address]);
  }, 0);
  const provider = {
    isMetaMask: true,
    selectedAddress: address,
    chainId: '0x1',
    isConnected() { return true; },
    request({ method, params = [] }: { method: string; params?: unknown[] }): Promise<unknown> {
      if (method === 'eth_accounts') return Promise.resolve([address]);
      if (method === 'eth_requestAccounts') { announceConnection(); return Promise.resolve([address]); }
      if (method === 'wallet_requestPermissions') {
        announceConnection();
        return Promise.resolve([{
          parentCapability: 'eth_accounts', caveats: [{ type: 'restrictReturnedAccounts', value: [address] }],
        }]);
      }
      if (method === 'eth_chainId') return Promise.resolve('0x1');
      if (method === 'net_version') return Promise.resolve('1');
      if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') return Promise.resolve(null);
      if (method !== 'personal_sign') return Promise.reject(new Error('지원하지 않는 지갑 요청이에요.'));
      if (typeof params[0] !== 'string' || !Array.isArray(params) ||
        typeof params[1] !== 'string' || params[1].toLowerCase() !== address.toLowerCase()) {
        return Promise.reject(new Error('서명 주소가 현재 월렛과 일치하지 않아요.'));
      }
      if (!browser.mobileApp?.postMessage) return Promise.reject(new Error('앱의 지갑 연결 기능을 사용할 수 없어요.'));
      return new Promise((resolve, reject) => {
        const requestId = crypto.randomUUID();
        pending.set(requestId, { resolve, reject });
        window.setTimeout(() => { const entry = pending.get(requestId); if (entry) {
          pending.delete(requestId); entry.reject(new Error('서명 요청 시간이 지났어요.'));
        } }, 300_000);
        browser.mobileApp?.postMessage({ detail: { message: JSON.stringify({
          type: 'took-wss:coinone-personal-sign', requestId, address, message: params[0],
        }) } });
      });
    },
    on(event: string, listener: (...args: unknown[]) => void) {
      if (typeof listener === 'function') {
        const group = listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
        group.add(listener);
        listeners.set(event, group);
      }
      return provider;
    },
    removeListener(event: string, listener: (...args: unknown[]) => void) {
      listeners.get(event)?.delete(listener);
      return provider;
    },
    enable() { return provider.request({ method: 'eth_requestAccounts' }); },
  };
  browser.ethereum = provider;
}

export function buildCoinoneBrowserBootstrap(address: string): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('연결할 EVM 월렛 주소가 없어요.');
  return `(function(){const __name=(fn)=>fn;(${prepareCoinoneAddressBook.toString()})(${JSON.stringify(address)});})();`;
}

function captureBithumbWalletConnectUri(): void {
  const browser = window as Window & { __tookWssBithumbCapture?: boolean;
    mobileApp?: { postMessage: (value: { detail: { message: string } }) => void } };
  if (browser.__tookWssBithumbCapture) return;
  browser.__tookWssBithumbCapture = true;
  const original = window.encodeURIComponent;
  let lastUri = '';
  window.encodeURIComponent = function (value: string | number | boolean) {
    // Bithumb calls encodeURIComponent(wcUri) immediately before assigning its
    // MetaMask intent URL. The native browser blocks that intent navigation.
    if (typeof value === 'string' && value.startsWith('wc:') && value.length < 4096
      && location.protocol === 'https:' && (location.hostname === 'bithumb.com' || location.hostname.endsWith('.bithumb.com'))
      && location.pathname.startsWith('/uhw/kyw/') && value !== lastUri) {
      lastUri = value;
      browser.mobileApp?.postMessage({ detail: { message: JSON.stringify({ type: 'took-wss:bithumb-wc-uri', uri: value }) } });
    }
    return original(value);
  };
}

export function buildBithumbBrowserBootstrap(): string {
  return `(function(){(${captureBithumbWalletConnectUri.toString()})();})();`;
}


export const exchangeStartUrls: Readonly<Record<ExchangeId, string>> = {
  bithumb: 'https://m.bithumb.com/react/login',
  coinone: 'https://coinone.co.kr/balance/transfer/withdrawal-address',
};

export function isExchangeUrlAllowed(rawUrl: string, allowedHost: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === 'https:' && (url.hostname === allowedHost || url.hostname.endsWith(`.${allowedHost}`));
  } catch { return false; }
}

// The router runs only inside an allowlisted exchange WebView. It receives a public
// EVM address and visual tenant metadata; it never observes credential fields or
// signs a transaction. A personal-sign request is sent to the host for approval.
function mountExchangeRouter(settings: ExchangeRouterSettings): void {
  if (location.protocol !== 'https:' || !(location.hostname === settings.allowedHost
    || location.hostname.endsWith(`.${settings.allowedHost}`))) return;
  if (settings.exchange === 'coinone') prepareCoinoneAddressBook(settings.address);
  const evmAssets = [
    { symbol: 'ETH', name: '이더리움' },
    { symbol: 'AVAX', name: '아발란체' },
    { symbol: 'ARB', name: '아비트럼' },
    { symbol: 'BNB', name: '비앤비' },
    { symbol: 'POL', name: '폴리곤' },
  ] as const;

  type RouterState = { running: boolean; expanded: boolean; completed: boolean; asset: string; assetName: string; status: string; stage: string; lastAction: number };
  type RouterWindow = Window & { __tookWssExchangeRouter?: { key: string; refresh: () => void } };
  const appWindow = window as RouterWindow;
  const key = `took-wss-router:${settings.exchange}:${settings.address.toLowerCase()}`;
  if (appWindow.__tookWssExchangeRouter?.key === key) { appWindow.__tookWssExchangeRouter.refresh(); return; }

  const storageKey = `took-wss-router-state:${settings.exchange}:${settings.address.toLowerCase()}`;
  let saved: Partial<RouterState> = {};
  try { saved = JSON.parse(sessionStorage.getItem(storageKey) || '{}') as Partial<RouterState>; } catch { /* Session storage is optional. */ }
  if (settings.exchange === 'coinone' && saved.completed === true) return;
  const savedAsset = evmAssets.find((asset) => asset.symbol === saved.asset) ?? evmAssets[0];
  const state: RouterState = {
    running: saved.running === true,
    expanded: saved.expanded !== false,
    completed: false,
    asset: savedAsset.symbol,
    assetName: typeof saved.assetName === 'string' && saved.assetName.length <= 50
      ? saved.assetName : savedAsset.name,
    status: '', stage: '', lastAction: 0,
  };
  let bithumbFormStartedAt = 0;
  const persist = () => { try { sessionStorage.setItem(storageKey, JSON.stringify({ running: state.running, expanded: state.expanded, completed: state.completed, asset: state.asset, assetName: state.assetName })); } catch { /* Continue without persistence. */ } };

  const host = document.createElement('div');
  host.id = 'took-wss-exchange-router';
  // Bithumb confirmation dialogs use z-index 900. Keep the helper below those
  // dialogs so its panel cannot block the customer's confirmation button.
  host.style.cssText = `all:initial;position:fixed;left:12px;bottom:max(88px,calc(env(safe-area-inset-bottom) + 76px));z-index:${settings.exchange === 'bithumb' ? 850 : 2147483646};max-width:calc(100vw - 24px);pointer-events:auto`;
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>
    :host{color-scheme:light}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}
    .card{width:min(252px,calc(100vw - 24px));border:1px solid #e2e8e6;border-radius:18px;background:#fff;color:var(--ink);box-shadow:0 12px 38px #10201530;font:13px/1.5 var(--font);overflow:hidden}
    .head{display:flex;align-items:center;gap:9px;padding:12px 12px 9px}.logo{width:34px;height:34px;flex:none;border-radius:10px;object-fit:contain;background:#f5f7f5}
    .headcopy{min-width:0;flex:1}.eyebrow{display:block;color:#6e7875;font-size:10px;line-height:1.3}.title{display:block;color:var(--ink);font-size:13px;line-height:1.4;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .iconbutton{display:grid;place-items:center;width:30px;height:30px;flex:none;border:0;border-radius:8px;background:#f3f6f3;color:var(--ink);font-size:17px}
    .body{padding:0 12px 12px}.route{margin:2px 0 9px;color:#75817d;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .status{margin:0 0 10px;color:var(--ink);font-size:12px;font-weight:700;line-height:1.55;word-break:keep-all;overflow-wrap:normal}
    .assetrow{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 9px;padding:8px 9px;border-radius:9px;background:#f6f8f6;font-size:11px;color:#65716d}
    .assetrow select{max-width:145px;min-width:0;border:0;background:transparent;color:var(--ink);font-size:11px;font-weight:800;text-align:right;outline:0}
    .actions{display:flex;gap:6px}.primary,.secondary{min-height:38px;padding:7px 9px;border-radius:9px;font-size:11px;font-weight:800;line-height:1.3;word-break:keep-all}
    .primary{flex:1;border:0;background:var(--primary);color:var(--primary-ink)}.secondary{border:1px solid #dfe5e1;background:#fff;color:var(--ink)}
    .foot{margin:8px 0 0;color:#78817e;font-size:10px;line-height:1.45;word-break:keep-all;overflow-wrap:normal}
    .bubble{display:none;align-items:center;gap:7px;max-width:210px;padding:8px 10px;border:1px solid #e2e8e6;border-radius:999px;background:#fff;color:var(--ink);box-shadow:0 8px 24px #10201525;font:700 12px var(--font)}
    .bubble img{width:24px;height:24px;border-radius:7px;object-fit:contain}
    :host([data-collapsed]) .card{display:none}:host([data-collapsed]) .bubble{display:flex}
    :host([data-handoff]) .assetrow,:host([data-handoff]) .actions,:host([data-handoff]) .foot{display:none}
    button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid var(--primary);outline-offset:2px}
    @media(prefers-reduced-motion:no-preference){.card,.bubble{animation:router-enter .18s ease-out}@keyframes router-enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}}
  </style>
  <section class="card" role="region" aria-label="${settings.exchangeName} 월렛 연결 라우터">
    <div class="head"><img class="logo" alt=""/><div class="headcopy"><span class="eyebrow">${settings.exchangeName} 연결 도우미</span><strong class="title"></strong></div><button class="iconbutton" id="minimize" aria-label="연결 도우미 접기" type="button">−</button></div>
    <div class="body"><p class="route" id="route"></p><p class="status" id="status" role="status"></p>
      <label class="assetrow">등록할 자산 <select id="asset" aria-label="등록할 자산"><option value="ETH">ETH · 이더리움</option><option value="AVAX">AVAX · 아발란체</option><option value="ARB">ARB · 아비트럼</option><option value="BNB">BNB · 비앤비</option><option value="POL">POL · 폴리곤</option></select></label>
      <div class="actions"><button class="primary" id="main" type="button"></button><button class="secondary" id="copy" type="button">주소 복사</button></div>
      <p class="foot">로그인·본인확인은 거래소에서, 지갑 서명은 월렛 앱에서 승인해 주세요.</p>
    </div>
  </section><button class="bubble" id="expand" type="button" aria-label="월렛 연결 도우미 펼치기"><img alt=""/><span>월렛 연결 도우미</span></button>`;
  host.style.setProperty('--primary', settings.color);
  host.style.setProperty('--ink', settings.ink);
  host.style.setProperty('--primary-ink', settings.primaryInk);
  host.style.setProperty('--font', settings.fontFamily);
  (document.body || document.documentElement).appendChild(host);
  const get = <T extends HTMLElement>(id: string): T => shadow.getElementById(id) as T;
  const title = shadow.querySelector('.title') as HTMLElement;
  title.textContent = `${settings.brandName} 연결`;
  shadow.querySelectorAll<HTMLImageElement>('img').forEach((img) => { img.src = settings.brandIcon; });
  get<HTMLSelectElement>('asset').value = state.asset;

  const path = () => location.pathname.toLowerCase();
  const onLoginPage = () => /\/(user|account)\/login|\/react\/login/.test(path())
    || (settings.exchange === 'bithumb' && path() === '/react/' && Boolean(findControl(['로그인'])));
  const visible = (element: HTMLElement) => element.getClientRects().length > 0;
  const controls = () => [...document.querySelectorAll<HTMLElement>('button,a,[role="button"]')]
    .filter((element) => !host.contains(element) && visible(element));
  const findControl = (names: string[]) => controls().find((element) => {
    const label = (element.getAttribute('aria-label') || element.textContent || '').replace(/\s+/g, ' ').trim();
    return names.some((name) => label === name || (label.length < 25 && label.includes(name)));
  });
  const setValue = (input: HTMLInputElement, value: string) => {
    if (input.value === value) return;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const textInput = (selector: string) => [...document.querySelectorAll<HTMLInputElement>(selector)]
    .find((input) => visible(input) && input.type !== 'password');
  const addressInput = () => {
    if (settings.exchange === 'bithumb' && !path().includes('/react/inout/address/register')) return undefined;
    return textInput('input[name="address"],input[placeholder*="출금 주소"],input[placeholder*="지갑 주소"],input[placeholder*="지갑주소"],input[placeholder*="주소 입력"]');
  };
  const aliasInput = () => textInput('input[name="nickname"],input[placeholder*="별칭"],input[aria-label*="별칭"]');
  const addressRegistered = () => settings.exchange === 'coinone'
    && path().includes('/balance/transfer/withdrawal-address')
    && Boolean(state.assetName)
    && [...document.querySelectorAll('article')].some((article) =>
      article.textContent?.toLowerCase().includes(settings.address.toLowerCase())
      && article.textContent?.includes(state.assetName));
  const completedAsset = (name: string) => settings.exchange === 'coinone'
    && path().includes('/balance/transfer/withdrawal-address')
    && [...document.querySelectorAll('article')].some((article) =>
      article.textContent?.toLowerCase().includes(settings.address.toLowerCase())
      && article.textContent?.includes(name)
      && ![...article.querySelectorAll('button')].some((button) => /등록하기|추가정보 등록/.test(button.textContent ?? '')));
  const copyAddress = async () => {
    try { await navigator.clipboard.writeText(settings.address); state.status = '월렛 주소를 복사했어요.'; }
    catch { window.prompt('월렛 주소를 복사해 주세요', settings.address); }
    render();
  };
  const exchangeFieldFocused = () => {
    const field = document.activeElement;
    return field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement
      || field instanceof HTMLSelectElement;
  };
  const render = () => {
    host.toggleAttribute('data-collapsed', !state.expanded || exchangeFieldFocused());
    const handoffToCustomer = settings.exchange === 'bithumb'
      && path().includes('/react/inout/address/register/additional');
    host.toggleAttribute('data-handoff', handoffToCustomer);
    get<HTMLButtonElement>('main').hidden = handoffToCustomer;
    get<HTMLSelectElement>('asset').querySelectorAll('option').forEach((option) => {
      const asset = evmAssets.find((item) => item.symbol === option.value);
      if (asset) option.textContent = `${asset.symbol} · ${asset.name}${completedAsset(asset.name) ? ' · 등록됨' : ''}`;
    });
    get('route').textContent = `${location.hostname}${location.pathname}`;
    get('status').textContent = state.status || (handoffToCustomer
      ? '개인지갑 서명과 이후 절차는 빗썸 화면에서 직접 마무리해 주세요.'
      : onLoginPage()
      ? `${settings.exchangeName}에 로그인한 뒤 연결을 시작해 주세요.`
      : addressRegistered() ? '등록된 월렛 주소의 연결을 이어갈 수 있어요.'
        : '로그인을 마쳤다면 월렛 주소 등록을 시작해 주세요.');
    get('main').textContent = state.running ? '일시정지' : state.stage === 'ready' || state.stage === 'registered' ? '다시 확인' : '연결 시작';
    persist();
  };
  const stop = (message: string, stage = 'paused') => { state.running = false; state.stage = stage; state.status = message; render(); };

  const run = () => {
    if (!state.running || Date.now() - state.lastAction < 650) return;
    if (onLoginPage()) { stop(`${settings.exchangeName} 로그인을 마치면 연결 시작을 눌러 주세요.`); return; }
    if (settings.exchange === 'bithumb' && path().includes('/react/inout/address/register/additional')) {
      stop('개인지갑 서명과 이후 절차는 빗썸 화면에서 직접 마무리해 주세요.', 'user-action-required');
      return;
    }
    if (settings.exchange === 'bithumb') {
      // Bithumb can change the address-book route while the completion dialog is open.
      // Locate the confirmation by its own text instead of the page pathname.
      const additional = controls().find((button) => {
        if (button.textContent?.trim() !== '추가정보 등록') return false;
        let parent = button.parentElement;
        for (let depth = 0; parent && depth < 7; depth += 1, parent = parent.parentElement) {
          if (parent.textContent?.includes('주소 등록이 완료')) return true;
        }
        return false;
      }) as HTMLButtonElement | undefined;
      if (additional && !additional.disabled && state.stage !== 'opening-additional') {
        state.stage = 'opening-additional';
        state.lastAction = Date.now();
        state.status = '빗썸 추가정보 등록 화면을 열고 있어요.';
        additional.click();
        render(); return;
      }
      if (state.stage === 'opening-additional') {
        if (Date.now() - state.lastAction < 10_000) return;
        stop('빗썸 추가정보 등록 화면을 확인해 주세요.', 'ready'); return;
      }
      if (state.stage === 'submitting-address') {
        if (Date.now() - state.lastAction < 10_000) return;
        stop('빗썸 주소 등록 결과를 확인해 주세요.', 'ready'); return;
      }
    }
    if (settings.exchange === 'bithumb' && path().includes('/react/inout/address/register')) {
      const metamask = [...document.querySelectorAll<HTMLButtonElement>('button[class*="ExchangeModal-module_exchange__select-item"]')]
        .find((button) => visible(button) && button.textContent?.includes('메타마스크(개인지갑)'));
      if (metamask) {
        state.lastAction = Date.now(); metamask.click();
        state.status = '메타마스크 개인지갑을 선택하고 있어요.'; render(); return;
      }
      const assetChoice = [...document.querySelectorAll<HTMLButtonElement>('button[class*="CoinSelectModal-module_exchange__select-item"]')]
        .find((button) => visible(button) && [...button.querySelectorAll('span')]
          .some((span) => span.textContent?.trim() === state.asset));
      if (assetChoice) {
        state.lastAction = Date.now(); assetChoice.click();
        state.status = `${state.asset} 자산을 선택하고 있어요.`; render(); return;
      }
      const assetSearch = textInput('input[placeholder*="가상자산 또는 심볼"]');
      if (assetSearch) {
        if (assetSearch.value !== state.asset) {
          state.lastAction = Date.now(); setValue(assetSearch, state.asset);
          state.status = `${state.asset} 자산을 찾고 있어요.`; render(); return;
        }
        if (Date.now() - state.lastAction > 2_000) stop(`${state.asset} 자산을 빗썸에서 직접 확인해 주세요.`);
        return;
      }
      const assetField = [...document.querySelectorAll<HTMLElement>('[class*="address-registration__item"]')]
        .find((item) => item.textContent?.includes('가상자산'));
      const assetTrigger = assetField?.querySelector<HTMLButtonElement>('button');
      if (assetTrigger && visible(assetTrigger) && !assetTrigger.textContent?.includes(`(${state.asset})`)) {
        state.lastAction = Date.now(); assetTrigger.click();
        state.status = `${state.asset} 자산 선택 화면을 열고 있어요.`; render(); return;
      }
    }
    if (settings.exchange === 'coinone' && path().includes('/balance/transfer/withdrawal-address')) {
      prepareCoinoneAddressBook(settings.address);
      const dialogs = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].filter(visible);
      if (dialogs.some((dialog) => dialog.textContent?.includes('모바일 웹에서 지원되지 않습니다'))) {
        stop('코인원 간편 등록은 PC 웹 화면에서 이어져야 해요. 연결 도우미를 다시 열어 주세요.');
        return;
      }
      const info = dialogs.find((dialog) => dialog.textContent?.includes('추가정보 등록'));
      if (info) {
        const consent = info.querySelector<HTMLInputElement>('input[name="isPersonalWalletAgreed"]');
        if (!consent) {
          const menu = [...document.querySelectorAll<HTMLElement>('[role="menu"]')].find(visible);
          const metamask = menu && [...menu.children].find((item) =>
            item.textContent?.includes('메타마스크') && item.textContent?.includes('MetaMask')) as HTMLElement | undefined;
          if (metamask) {
            state.lastAction = Date.now(); metamask.click();
            state.status = '메타마스크 간편 등록을 선택하고 있어요.'; render(); return;
          }
          const chooser = [...info.querySelectorAll<HTMLButtonElement>('button')]
            .find((button) => button.textContent?.includes('가상자산 사업자 선택'));
          if (chooser) { state.lastAction = Date.now(); chooser.click(); state.status = '간편 등록 항목을 찾고 있어요.'; render(); return; }
        } else {
          if (!consent.checked) { state.lastAction = Date.now(); consent.click(); state.status = '연결 동의 항목을 확인하고 있어요.'; render(); return; }
          const connect = [...info.querySelectorAll<HTMLButtonElement>('button')]
            .find((button) => button.textContent?.trim() === '연결하기');
          if (connect && !connect.disabled && state.stage !== 'connecting') {
            state.stage = 'connecting'; state.lastAction = Date.now(); connect.click();
            state.status = '메타마스크 연결 화면을 열고 있어요.'; render(); return;
          }
          if (state.stage === 'connecting') return;
        }
        state.status = '코인원 추가정보 화면을 확인하고 있어요.';
        render(); return;
      }
      if (addressRegistered() && !info) {
        const row = [...document.querySelectorAll<HTMLElement>('article')]
          .find((article) => article.textContent?.toLowerCase().includes(settings.address.toLowerCase())
            && article.textContent?.includes(state.assetName));
        const register = [...(row?.querySelectorAll<HTMLButtonElement>('button') || [])]
          .find((button) => button.textContent?.trim() === '등록하기');
        if (register) { state.lastAction = Date.now(); register.click(); state.status = '추가정보 등록을 열고 있어요.'; render(); return; }
        stop('코인원 주소록의 등록 상태를 확인해 주세요.', 'registered'); return;
      }
    }
    const address = addressInput();
    if (address) {
      const asset = textInput('input[name="coinId"],input[aria-label*="자산"],input[placeholder*="가상자산"]');
      if (asset && asset.value !== state.asset && asset.value !== state.assetName) {
        if (settings.exchange === 'coinone' && asset.name === 'coinId') {
          asset.focus();
          setValue(asset, state.asset);
          state.status = `${state.asset} 자산을 찾고 있어요.`;
        } else {
          state.status = `${state.asset} 자산을 거래소 화면에서 선택해 주세요.`;
        }
        render(); return;
      }
      if (asset && asset.value === state.asset && settings.exchange === 'coinone' && asset.name === 'coinId') {
        const choice = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
          .find((option) => visible(option) && option.textContent?.trim().endsWith(`(${state.asset})`));
        if (choice) {
          state.assetName = choice.textContent?.trim().replace(/\s*\([^)]*\)$/, '') || '';
          choice.click();
          state.status = `${state.asset} 자산을 골랐어요. 월렛 주소를 입력하고 있어요.`;
        } else {
          state.status = `${state.asset} 자산을 거래소 화면에서 선택해 주세요.`;
        }
        render(); return;
      }
      const addressNeedsUpdate = address.value.toLowerCase() !== settings.address.toLowerCase();
      if (addressNeedsUpdate) setValue(address, settings.address);
      const alias = aliasInput();
      const aliasNeedsUpdate = Boolean(alias && alias.value !== settings.walletLabel);
      if (alias && aliasNeedsUpdate) setValue(alias, settings.walletLabel);
      if (settings.exchange === 'bithumb') {
        bithumbFormStartedAt ||= Date.now();
        if (addressNeedsUpdate || aliasNeedsUpdate) {
          state.lastAction = Date.now();
          state.stage = 'verifying-address';
          state.status = '월렛 주소와 별칭을 확인하고 있어요.';
          render(); return;
        }
      }
      if (address.value.toLowerCase() === settings.address.toLowerCase()) {
        if (settings.exchange === 'coinone') {
          const dialog = address.closest<HTMLElement>('[role="dialog"]');
          const add = [...(dialog?.querySelectorAll<HTMLButtonElement>('button') || [])]
            .find((button) => button.textContent?.trim() === '추가');
          if (add && !add.disabled && state.stage !== 'saving-address') {
            state.stage = 'saving-address'; state.lastAction = Date.now(); add.click();
            state.status = '월렛 주소를 코인원 주소록에 추가하고 있어요.'; render();
          }
        } else {
          const registrationItems = [...document.querySelectorAll<HTMLElement>('[class*="address-registration__item"]')];
          const selectedWallet = registrationItems.find((item) => item.textContent?.includes('거래소 / 개인지갑'))
            ?.querySelector<HTMLButtonElement>('button[class*="DefaultSelectButton"]');
          const selectedAsset = registrationItems.find((item) => item.textContent?.includes('가상자산'))
            ?.querySelector<HTMLButtonElement>('button[class*="DefaultSelectButton"]');
          const selectedNetwork = registrationItems.find((item) => item.textContent?.includes('네트워크'))
            ?.querySelector<HTMLButtonElement>('button[class*="DefaultSelectButton"]');
          const register = [...document.querySelectorAll<HTMLButtonElement>('button')]
            .find((button) => visible(button) && button.textContent?.trim() === '주소 등록');
          if (selectedWallet?.textContent?.includes('메타마스크(개인지갑)')
            && selectedAsset?.textContent?.includes(`(${state.asset})`)
            && selectedNetwork?.textContent?.trim()
            && alias?.value === settings.walletLabel
            && register && !register.disabled) {
            state.running = true;
            state.stage = 'submitting-address';
            state.lastAction = Date.now();
            register.click();
            state.status = '빗썸 주소 등록 결과를 확인하고 있어요.';
            render();
          } else if (Date.now() - bithumbFormStartedAt < 12_000) {
            state.stage = 'verifying-address';
            state.status = '빗썸에서 주소 등록 버튼이 준비되기를 기다리고 있어요.';
            render();
          } else stop('등록할 자산·네트워크·주소를 빗썸 화면에서 확인해 주세요.', 'ready');
        }
      }
      return;
    }
    if (settings.exchange === 'coinone') {
      if (!path().includes('/balance/transfer/withdrawal-address')) {
        state.status = '코인원 출금 주소록으로 이동하고 있어요.';
        render();
        location.assign('https://coinone.co.kr/balance/transfer/withdrawal-address');
        return;
      }
      if (state.stage === 'opening-form' && Date.now() - state.lastAction < 4000) return;
      const add = findControl(['주소 추가', '주소 등록', '새 주소']);
      if (add) { state.lastAction = Date.now(); state.stage = 'opening-form'; add.click(); state.status = '등록할 자산과 월렛 주소를 확인하고 있어요.'; render(); return; }
      stop('코인원 주소 추가 화면을 열어 주세요. 열리면 다시 연결 시작을 눌러 주세요.');
      return;
    }
    const register = findControl(['주소 등록', '주소 추가', '새 주소']);
    const book = findControl(['주소록', '출금주소']);
    const deposit = findControl(['입출금']);
    const next = register || book || deposit;
    if (next) {
      state.lastAction = Date.now();
      next.click();
      state.status = `${next.textContent?.trim() || '주소 등록'} 화면으로 이동하고 있어요.`;
      render();
      return;
    }
    stop('빗썸에서 주소 등록 화면을 열어 주세요. 화면이 열리면 연결 시작을 눌러 주세요.');
  };
  get('main').addEventListener('click', () => {
    if (state.running) { stop('잠시 멈췄어요. 다시 시작하면 현재 화면부터 이어서 진행해요.'); return; }
    if (onLoginPage()) { stop(`${settings.exchangeName} 로그인을 마친 뒤 다시 눌러 주세요.`); return; }
    state.running = true;
    state.stage = 'running';
    bithumbFormStartedAt = 0;
    state.status = '주소 등록 화면을 찾고 있어요.';
    render();
    run();
  });
  get('copy').addEventListener('click', () => { void copyAddress(); });
  get<HTMLSelectElement>('asset').addEventListener('change', (event) => {
    const choice = evmAssets.find((asset) => asset.symbol === (event.currentTarget as HTMLSelectElement).value) ?? evmAssets[0];
    state.asset = choice.symbol;
    state.assetName = choice.name;
    bithumbFormStartedAt = 0;
    state.status = `${state.asset} 자산을 거래소에서도 확인해 주세요.`;
    render();
  });
  get('minimize').addEventListener('click', () => { state.expanded = false; render(); });
  get('expand').addEventListener('click', () => { state.expanded = true; render(); });
  document.addEventListener('focusin', render);
  document.addEventListener('focusout', () => window.setTimeout(render, 0));
  window.addEventListener('took-wss:exchange-router-complete', () => {
    state.running = false;
    state.completed = true;
    persist();
    host.remove();
    delete appWindow.__tookWssExchangeRouter;
  }, { once: true });
  window.addEventListener('took-wss:bithumb-wc-status', ((event: CustomEvent<{ message: string }>) => {
    if (settings.exchange !== 'bithumb') return;
    state.status = event.detail?.message || '';
    state.running = false;
    state.stage = 'user-action-required';
    render();
  }) as EventListener);
  appWindow.__tookWssExchangeRouter = { key, refresh: render };
  let previousPath = location.pathname;
  window.setInterval(() => {
    if (!host.isConnected) return;
    if (location.pathname !== previousPath) { previousPath = location.pathname; state.status = ''; render(); }
    if (!state.running && state.stage === 'ready' && addressRegistered()) {
      state.status = '월렛 주소가 등록되었어요. 연결 시작을 눌러 간편 등록을 이어가세요.';
      render();
    }
    if (state.running) run();
  }, 1100);
  render();
}

export function buildExchangeRouterScript(settings: ExchangeRouterSettings): string {
  if (!/^0x[0-9a-fA-F]{40}$/.test(settings.address)) throw new Error('연결할 EVM 월렛 주소가 없어요.');
  // The production minifier renames the helper referenced by mountExchangeRouter.
  // Bind that exact runtime name inside the isolated exchange page.
  const helperName = prepareCoinoneAddressBook.name;
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(helperName)) throw new Error('Exchange router unavailable');
  return `(function(){const __name=(fn)=>fn;const ${helperName}=${prepareCoinoneAddressBook.toString()};(${mountExchangeRouter.toString()})(${JSON.stringify(settings)});})();`;
}
