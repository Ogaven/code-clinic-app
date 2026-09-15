// PM2 process definitions for Code Clinic production.
//
// Both apps run from paths that pass through a `current` symlink managed by
// scripts/deploy/remote-release-*.sh. Deploys flip the symlink, they never
// rewrite files inside the directory a running process has open. See
// DEPLOYMENT.md before changing anything here.
//
// codeclinic-api dist/ and codeclinic-web apps/web/current/ are symlinks,
// not real directories — do not replace them with `mkdir`.
module.exports = {
  apps: [
    {
      name: 'codeclinic-api',
      script: '/var/www/codeclinic/apps/api/dist/main.js',
      cwd: '/var/www/codeclinic',
      interpreter: 'node',
      exec_mode: 'fork',
      env: { NODE_ENV: 'production' },
      max_memory_restart: '600M',
      autorestart: true,
    },
    {
      name: 'codeclinic-web',
      script: '/var/www/codeclinic/apps/web/current/apps/web/server.js',
      cwd: '/var/www/codeclinic/apps/web/current/apps/web',
      interpreter: 'node',
      exec_mode: 'fork',
      env: { NODE_ENV: 'production', PORT: '3000', HOSTNAME: '0.0.0.0' },
      max_memory_restart: '700M',
      autorestart: true,
    },
  ],
};
