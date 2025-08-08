const {MinecraftLoaders} = require('../../main.js');
MinecraftLoaders.fabric({
  root: './.minecraft',
  version: '1.20.1',
}).on('data', (msg) => {
  console.log(`[Fabric] Descargando: ${msg.progress}/${msg.total}`);
}).on('done', () => {
  console.log('[Fabric] Instalado correctamente');
});
