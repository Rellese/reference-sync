/* Локальный просмотр интерфейса плагина в браузере.
   Нужен только для разработки: сам плагин запускается внутри Eagle
   и никакого сервера не использует. */
module.exports = {
  apps: [
    {
      name: 'reference-sync-preview',
      script: 'npx',
      args: 'http-server . -p 3000 -a 0.0.0.0 --cors -c-1',
      cwd: '/home/user/webapp',
      watch: false,
      instances: 1,
      exec_mode: 'fork',
    },
  ],
};
