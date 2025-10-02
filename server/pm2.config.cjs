module.exports = {
  apps: [
    {
      name: "simple-post-server",
      script: "./dist/index.js",
      instances: 1,
      exec_mode: "cluster",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      env_production: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      // Restart configuration
      min_uptime: "10s",
      max_restarts: 5,
      restart_delay: 1000,
      // Health monitoring
      health_check_grace_period: 3000,
      // Resource limits
      kill_timeout: 30_000,
      listen_timeout: 10_000,
    },
  ],
};
