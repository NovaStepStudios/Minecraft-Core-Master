const { ForgeDownloader } = require('../../dist/Minecraft-Loaders/Forge/Forge');

(async () => {
  const downloader = new ForgeDownloader({
    root: '.MiCarpetaForge',   // Opcional
    version: '1.21.8-58.0.10',  // Obligatorio
    type: 'installer'           // Opcional: 'installer' o 'universal'
  });

  // Mostrar progreso cada 500ms
  const interval = setInterval(() => {
    console.log(`Progress: ${downloader.Progress}%`);
    if (downloader.Progress >= 100) clearInterval(interval);
  }, 500);

  const result = await downloader.download();
  console.log('Forge descargado en:', result.path);
  console.log('SHA1:', result.hash);
})();