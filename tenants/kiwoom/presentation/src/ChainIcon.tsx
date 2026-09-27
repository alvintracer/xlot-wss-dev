import { useState } from 'react';

interface ChainIconProps {
  chainId: string;
  className: string;
}

const chainIconExtensions: Record<string, 'png' | 'svg'> = {
  ethereum: 'png',
  polygon: 'png',
  arbitrum: 'png',
  base: 'png',
  bnb: 'png',
  solana: 'png',
  bitcoin: 'png',
  tron: 'png',
  xrp: 'svg',
};

function chainIconUrl(chainId: string): string | null {
  const normalized = chainId.trim().toLowerCase();
  const extension = chainIconExtensions[normalized];
  return extension ? `/assets/chains/${normalized}.${extension}` : null;
}

export function ChainIcon({ chainId, className }: ChainIconProps) {
  const src = chainIconUrl(chainId);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src === failedSrc;

  return (
    <span className={`${className} kw-coin-icon`} aria-hidden="true">
      {src && !failed ? (
        <img src={src} alt="" width="38" height="38" loading="lazy" decoding="async" onError={() => setFailedSrc(src)} />
      ) : <span>{chainId.slice(0, 2).toUpperCase()}</span>}
    </span>
  );
}
