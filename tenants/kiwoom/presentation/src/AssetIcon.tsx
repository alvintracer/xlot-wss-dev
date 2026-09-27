import { useState } from 'react';

interface AssetIconProps {
  symbol: string;
  iconAssetId?: string;
  className: string;
}

const supportedSymbols = new Set([
  'BNB', 'BTC', 'DAI', 'ETH', 'EURC', 'FDUSD', 'GUSD', 'JPYC', 'POL', 'PYUSD',
  'RLUSD', 'SOL', 'TRX', 'USDC', 'USDG', 'USDP', 'USDS', 'USDT', 'XRP', 'XSGD', 'XUSD',
]);

function assetIconUrl(symbol: string, iconAssetId?: string): string | null {
  const normalized = symbol.trim().toUpperCase();
  if (!supportedSymbols.has(normalized)) return null;
  if (iconAssetId && iconAssetId !== `coin:${normalized.toLowerCase()}`) return null;
  const extension = normalized === 'XRP' ? 'svg' : 'png';
  return `/assets/coins/${normalized.toLowerCase()}.${extension}`;
}

export function AssetIcon({ symbol, iconAssetId, className }: AssetIconProps) {
  const src = assetIconUrl(symbol, iconAssetId);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src === failedSrc;

  return (
    <span className={`${className} kw-coin-icon`} aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" width="38" height="38" loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />
      ) : <span>{symbol.slice(0, 2)}</span>}
    </span>
  );
}
