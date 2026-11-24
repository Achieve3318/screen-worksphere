module.exports = {
  apps: [
    {
      name: 'screenvault-api',
      cwd: '/root/screenshot_app/apps/api',
      script: 'node_modules/.bin/tsx',
      args: 'src/index.ts',
      interpreter: 'none',
      env: {
        NODE_ENV: 'development',
      },
      max_memory_restart: '1G',
      time: true,
    },
    {
      name: 'screenvault-admin',
      cwd: '/root/screenshot_app/apps/admin',
      script: 'node_modules/.bin/next',
      args: 'start --hostname 0.0.0.0 --port 3001',
      interpreter: 'none',
      env: {
        NODE_ENV: 'production',
        SCREENVAULT_API_URL: 'http://127.0.0.1:4000',
      },
      max_memory_restart: '1G',
      time: true,
    },
  ],
}
