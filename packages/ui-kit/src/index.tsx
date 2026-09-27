import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';

export function WssPanel({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <section className={`wss-panel ${className}`.trim()} {...props} />;
}

export function WssPill({ tone = 'neutral', children }: { tone?: 'neutral' | 'brand' | 'success'; children: ReactNode }) {
  return <span className={`wss-pill wss-pill--${tone}`}>{children}</span>;
}

export function WssButton({ className = '', variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return <button className={`wss-button wss-button--${variant} ${className}`.trim()} {...props} />;
}
