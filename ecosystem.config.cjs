/**
 * PM2 Ecosystem Configuration
 * 
 * This configuration file is used to manage the MTGEDH server with PM2.
 * 
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 start ecosystem.config.cjs --env production
 *   pm2 restart ecosystem.config.cjs
 *   pm2 stop ecosystem.config.cjs
 *   pm2 delete ecosystem.config.cjs
 * 
 * Monitor:
 *   pm2 monit
 *   pm2 logs mtgedh-server
 */

module.exports = {
  apps: [
    {
      name: 'mtgedh-server',
      script: './server/src/index.ts',
      interpreter: 'node',
      interpreter_args: '--loader tsx/esm --enable-source-maps',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
      // Logging configuration
      log_file: './logs/mtgedh-combined.log',
      out_file: './logs/mtgedh-out.log',
      error_file: './logs/mtgedh-error.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      // Restart policy
      min_uptime: '5s',
      max_restarts: 10,
      restart_delay: 4000,
      // Graceful shutdown
      kill_timeout: 5000,
      listen_timeout: 8000,
      // Additional options
      time: true,
    },
  ],
};
