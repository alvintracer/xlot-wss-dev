import type { CapacitorConfig } from '@capacitor/cli';

// Device-validation build. The tenant host is the existing signed-session WSS
// host; the native layer does not create or select a tenant from URL input.
const config: CapacitorConfig = {
  appId: 'com.tookwss.shinhan',
  appName: '신한 슈퍼쏠',
  webDir: 'www',
  loggingBehavior: 'none',
  server: { url: 'https://www.took-wss.com/shinhan/app' },
  android: {
    backgroundColor: '#F0F3FA',
    allowMixedContent: false,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
