/** Public wallet assets live under the WebView build base, not the host origin root. */
export function walletPublicAssetUrl(path: string, baseUrl?: string): string {
  const resolvedBase = baseUrl ?? (typeof document === 'undefined'
    ? '/'
    : document.querySelector<HTMLMetaElement>('meta[name="wss-wallet-public-base"]')?.content || '/');
  return `${resolvedBase.replace(/\/?$/, '/')}${path.replace(/^\/+/, '')}`;
}
