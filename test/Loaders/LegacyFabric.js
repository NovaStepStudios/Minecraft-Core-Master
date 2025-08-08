const {MinecraftLoaders} = require('../../main.js');
MinecraftLoaders.legacyfabric({
  root: './.minecraft',
  version: '1.8.9', // Verifica versiones en: https://meta.legacyfabric.net/v2/versions/installer
}).on('data', (msg) => {
  console.log(`[LegacyFabric] Progreso: ${msg.progress}/${msg.total}`);
});