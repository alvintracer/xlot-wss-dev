import { useEffect, useState, type CSSProperties } from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowRight, CheckCircle, CopySimple, DownloadSimple, ShareNetwork } from '@phosphor-icons/react';
import './InstallLanding.css';
import { readIncomingClaimCode } from './claimDeepLink';

export interface InstallLandingConfig {
  tenantId: string;
  brandName: string;
  eyebrow: string;
  heading: string;
  description: string;
  iconFile: string;
  launchSplash?: { image: string; background: string };
  fontFamily: string;
  colors: {
    canvas: string;
    ink: string;
    muted: string;
    primary: string;
    primaryInk: string;
    accent: string;
    border: string;
  };
}

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

type Platform = 'ios' | 'android-chrome' | 'android-other' | 'desktop-chrome' | 'other';

let installPrompt: InstallPromptEvent | null = null;

// Capture the install event before React mounts. It may fire shortly after the manifest loads.
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    if (import.meta.env.VITE_WSS_PUBLIC_PREVIEW !== 'true'
      || window.location.pathname.replace(/\/$/, '') !== `/${import.meta.env.VITE_WSS_PREVIEW_TENANT}/app`
      || isInstalledDisplayMode()) return;
    event.preventDefault();
    installPrompt = event as InstallPromptEvent;
    window.dispatchEvent(new Event('wallet-install-ready'));
  });
}

function platform(): Platform {
  const agent = navigator.userAgent;
  if (/iPhone|iPad|iPod/i.test(agent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/i.test(agent)) return /Chrome\/\d+/i.test(agent) && !/EdgA|SamsungBrowser|OPR|UCBrowser|Firefox|; wv\b/i.test(agent)
    ? 'android-chrome' : 'android-other';
  if (/Chrome\/\d+/i.test(agent) && !/Edg|OPR/i.test(agent)) return 'desktop-chrome';
  return 'other';
}

function isInstalledDisplayMode(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function webContinueKey(tenantId: string): string { return `took-wss:${tenantId}-web-continue`; }

export function shouldShowInstallLanding(config: InstallLandingConfig): boolean {
  if (Capacitor.isNativePlatform()) return false;
  if (readIncomingClaimCode(config.tenantId)) return false;
  if (/^[0-9a-f-]{36}$/i.test(new URLSearchParams(window.location.hash.slice(1)).get('payment') ?? '')) return false;
  if (import.meta.env.VITE_WSS_PUBLIC_PREVIEW !== 'true'
    || import.meta.env.VITE_WSS_PREVIEW_TENANT !== config.tenantId
    || window.location.pathname.replace(/\/$/, '') !== `/${config.tenantId}/app`
    || isInstalledDisplayMode()) return false;
  try { return window.sessionStorage.getItem(webContinueKey(config.tenantId)) !== '1'; }
  catch { return true; }
}

export function rememberWebChoice(config: InstallLandingConfig): void {
  try { window.sessionStorage.setItem(webContinueKey(config.tenantId), '1'); }
  catch { /* The user can still continue in this tab. */ }
}

function chromeIntentUrl(): string {
  const target = `${window.location.origin}${window.location.pathname}`;
  const fallback = new URL(target);
  fallback.searchParams.set('chrome', 'unavailable');
  return `intent://${window.location.host}${window.location.pathname}#Intent;scheme=${window.location.protocol.replace(':', '')};package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(fallback.href)};end`;
}

export function InstallLanding({ config, onContinue }: { config: InstallLandingConfig; onContinue: () => void }) {
  const [device] = useState(platform);
  const [installAvailable, setInstallAvailable] = useState(Boolean(installPrompt));
  const [installed, setInstalled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showSteps, setShowSteps] = useState(device === 'ios');
  const [message, setMessage] = useState(() => new URLSearchParams(window.location.search).get('chrome') === 'unavailable'
    ? 'Chrome을 열지 못했어요. Chrome에서 이 주소를 열거나 모바일 웹으로 이용해 주세요.' : '');
  const logoUrl = `${import.meta.env.BASE_URL}icons/${config.iconFile}`;
  const currentUrl = `${window.location.origin}${window.location.pathname}`;
  const theme = {
    '--install-canvas': config.colors.canvas,
    '--install-ink': config.colors.ink,
    '--install-muted': config.colors.muted,
    '--install-primary': config.colors.primary,
    '--install-primary-ink': config.colors.primaryInk,
    '--install-accent': config.colors.accent,
    '--install-border': config.colors.border,
    '--install-font': config.fontFamily,
  } as CSSProperties;

  useEffect(() => {
    const updateInstall = () => setInstallAvailable(Boolean(installPrompt));
    const onInstalled = () => { installPrompt = null; setInstalled(true); setInstallAvailable(false); setMessage(`설치가 완료됐어요. 홈 화면에서 ${config.brandName}을 열어 주세요.`); };
    window.addEventListener('wallet-install-ready', updateInstall);
    window.addEventListener('appinstalled', onInstalled);
    if ('serviceWorker' in navigator) {
      // Network only: wallet and API responses must never enter an offline cache.
      void navigator.serviceWorker.register(`${import.meta.env.BASE_URL}wallet-install-sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => {});
    }
    return () => {
      window.removeEventListener('wallet-install-ready', updateInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, [config.brandName]);

  const install = async () => {
    const pending = installPrompt;
    if (!pending) {
      setShowSteps(true);
      setMessage(device === 'ios'
        ? '브라우저의 공유 메뉴에서 홈 화면에 추가해 주세요.'
        : '설치 확인창이 아직 준비되지 않았어요. Chrome 메뉴의 앱 설치를 이용하거나 잠시 후 다시 눌러 주세요.');
      return;
    }
    installPrompt = null;
    setInstallAvailable(false);
    setBusy(true);
    try {
      await pending.prompt();
      const choice = await pending.userChoice;
      setMessage(choice.outcome === 'accepted'
        ? `설치가 진행됩니다. 완료되면 홈 화면에서 ${config.brandName}을 열어 주세요.`
        : '설치를 취소했어요. Chrome 메뉴의 앱 설치로 다시 진행할 수 있어요.');
    } catch {
      setShowSteps(true);
      setMessage('설치 확인창을 열지 못했어요. Chrome 메뉴에서 앱 설치를 선택해 주세요.');
    } finally { setBusy(false); }
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(currentUrl);
      setMessage('주소를 복사했어요. Safari에서 붙여넣고 홈 화면에 추가해 주세요.');
    } catch { setMessage(`주소를 복사하지 못했어요. Safari에서 ${currentUrl}을 열어 주세요.`); }
  };

  const isChrome = device === 'android-chrome' || device === 'desktop-chrome';
  const installTitle = device === 'ios' ? '홈 화면에 추가하기' : device === 'android-other' ? 'Chrome에서 설치하기' : '앱 설치하기';

  return <main className="install-landing" style={theme} aria-labelledby="install-landing-title">
    <div className="install-landing__content">
      <div className="install-landing__brand"><img className="install-landing__brand-mark" src={logoUrl} alt="" width="27" height="27" /><span>{config.brandName}</span></div>
      <div className="install-landing__hero">
        <img className="install-landing__icon" src={logoUrl} alt={`${config.brandName} 앱 아이콘`} width="144" height="144" />
        <span className="install-landing__eyebrow">{config.eyebrow}</span>
        <h1 id="install-landing-title">{config.heading}</h1>
        <p>{config.description}</p>
      </div>
      <section className="install-landing__actions" aria-label={`${config.brandName} 시작 방법`}>
        <div className="install-landing__buttons">
          {device === 'android-other'
            ? <a className="install-landing__button install-landing__button--primary" href={chromeIntentUrl()}><DownloadSimple aria-hidden="true" />{installTitle}</a>
            : <button className="install-landing__button install-landing__button--primary" type="button" disabled={busy || installed} onClick={() => void install()}>
              {installed ? <CheckCircle aria-hidden="true" /> : <DownloadSimple aria-hidden="true" />}{busy ? '설치 확인 중' : installed ? '설치 완료' : installTitle}
            </button>}
          <button className="install-landing__button install-landing__button--secondary" type="button" onClick={onContinue}>모바일 웹으로 이용하기</button>
        </div>
        <p className="install-landing__hint">{device === 'ios'
          ? 'iPhone에서는 공유 메뉴를 통해 홈 화면에 추가할 수 있어요.'
          : device === 'android-other'
            ? 'Chrome이 열리면 앱 설치하기를 한 번 더 눌러 주세요.'
            : isChrome && installAvailable
              ? '설치 버튼을 누르면 Chrome의 확인창이 열려요.'
              : '설치 항목이 보이지 않으면 브라우저 메뉴를 확인해 주세요.'}</p>
        {message ? <p className="install-landing__message" role="status">{message}</p> : null}
        {showSteps ? <div className="install-landing__steps" aria-label="설치 방법">
          {device === 'ios' ? <>
            <strong><ShareNetwork size={19} aria-hidden="true" />iPhone에서 추가하기</strong>
            <ol><li>브라우저의 <b>공유</b> 버튼을 누르세요. Safari에서는 <b>⋯ → 공유</b>로 열 수도 있어요.</li><li><b>홈 화면에 추가</b>를 선택하세요.</li><li><b>웹 앱으로 열기</b>가 보이면 켜고 추가하세요.</li></ol>
            <p>메뉴가 보이지 않으면 Safari에서 이 주소를 열어 주세요.</p>
            <button className="install-landing__copy" type="button" onClick={() => void copyAddress()}><CopySimple size={17} aria-hidden="true" />주소 복사</button>
          </> : <>
            <strong><DownloadSimple size={19} aria-hidden="true" />Chrome에서 설치하기</strong>
            <p>Chrome 오른쪽 위 <b>⋮ 메뉴</b>에서 <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>를 선택해 주세요.</p>
          </>}
        </div> : null}
        {device === 'android-other' ? <button className="install-landing__help" type="button" onClick={() => setShowSteps((value) => !value)}>설치 방법 보기 <ArrowRight size={15} aria-hidden="true" /></button> : null}
      </section>
    </div>
  </main>;
}
