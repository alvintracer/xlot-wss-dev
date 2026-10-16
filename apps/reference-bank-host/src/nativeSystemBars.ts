import { Capacitor, registerPlugin } from '@capacitor/core';

const systemBars = registerPlugin<{
  setSurface(options: { topColor: string; bottomColor: string }): Promise<void>;
}>('TookSystemBars');

export function computedHexColor(element: Element | null, fallback: string): string {
  if (!element) return fallback;
  const color = getComputedStyle(element).backgroundColor;
  const match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)$/.exec(color);
  if (!match || (match[4] !== undefined && Number(match[4]) < 1)) return fallback;
  return `#${match.slice(1, 4).map((value) => Number(value).toString(16).padStart(2, '0')).join('')}`;
}

export async function setNativeSystemBarSurface(topColor: string, bottomColor: string): Promise<void> {
  if (!Capacitor.isNativePlatform() || Capacitor.getPlatform() !== 'android') return;
  await systemBars.setSurface({ topColor, bottomColor });
}
