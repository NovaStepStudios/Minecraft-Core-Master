const {MinecraftLoaders} = require('../../main.js');
MinecraftLoaders.forge({
  root: './.minecraft',
  version: '1.16.5-36.2.20',
}).on('data', (msg) => {
  console.log(`[Forge] Progreso: ${msg.progress}/${msg.total}`);
}).on('done', () => {
  console.log('[Forge] Instalación completada');
}).on('error', console.error);

// Link https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json