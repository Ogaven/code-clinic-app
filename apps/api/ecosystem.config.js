module.exports = {
  apps: [
    {
      name: 'codeclinic-api',
      script: 'dist/main.js',
      cwd: '/var/www/codeclinic/apps/api',
      env: { NODE_ENV: 'production' }
    }
  ]
}
