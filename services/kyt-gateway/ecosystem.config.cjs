module.exports = {
  apps: [
    {
      name: "took-wss-kyt-gateway",
      script: "server.js",
      cwd: "/opt/took-wss-kyt-gateway",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        ENV_FILE: "/etc/took-wss-kyt.env",
        WSS_KYT_START_SERVER: "1",
      },
    },
  ],
};
