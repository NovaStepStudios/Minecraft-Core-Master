const { MinecraftLoaders } = require('../../main.js');
MinecraftLoaders.quilt({
  root: './.minecraft',
  version: '1.20',
}).on('data', (msg) => {
  console.log(`[Quilt] Descargando: ${msg.progress}/${msg.total}`);
});