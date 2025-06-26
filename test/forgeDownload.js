const forge = require('../components/download/loaders/forge/forge.js');

(async () => {
  try {
    await forge.downloadAndInstall('1.19.4-45.1.0', './MinecraftAA');
    console.log('Forge listo para usarse!');
  } catch (e) {
    console.error('Falló la instalación de Forge:', e);
  }
})();
