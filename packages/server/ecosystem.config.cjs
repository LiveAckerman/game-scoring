const appName = process.env.APP_NAME || 'jf-server';
const appPort = Number(process.env.APP_PORT || process.env.PORT || 9090);

module.exports = {
  apps: [
    {
      name: appName,
      script: 'dist/main.js',
      cwd: __dirname,
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
        PORT: appPort,
      },
    },
  ],
};
