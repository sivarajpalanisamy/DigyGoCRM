module.exports = {
  apps: [
    {
      name: 'digygocrm',
      cwd: '/var/www/digygocrm/backend',
      script: 'dist/index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      // 512M was too low — a normal CRM working set crosses it under load, so PM2
      // was force-restarting the live app constantly. 1G gives real headroom while
      // staying well under the box's memory ceiling (shared with n8n/postgres/etc).
      max_memory_restart: '1G',
      // Give a crashed process a moment before respawning + flag rapid crash loops
      // instead of hammering restarts (min_uptime: a boot faster than 10s = unstable).
      min_uptime: '10s',
      max_restarts: 20,
      env_production: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
    },
  ],
};
