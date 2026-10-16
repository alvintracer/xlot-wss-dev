import type { CapacitorConfig } from '@capacitor/cli';

// Device-validation build. The tenant host is the existing signed-session WSS
// host; the native layer does not create or select a tenant from URL input.
const config: CapacitorConfig = {
  appId: 'com.tookwss.namu',
  appName: '나무 월렛',
  webDir: 'www',
  loggingBehavior: 'none',
  server: { url: 'https://www.took-wss.com/namu/app' },
  android: {
    backgroundColor: '#D3E9EA',
    allowMixedContent: false,
    webContentsDebuggingEnabled: true,
  },
};

export default config;
