const { MinecraftAssetsDownloader } = require('../../dist/handlers/download/Handlers/Assets');

const root = './minecraft'; // Carpeta donde se guardarán los assets
const version = 'rd-132211';   // Versión de Minecraft a descargar
const maxConcurrency = 20;   // Cantidad máxima de descargas simultáneas

const downloader = new MinecraftAssetsDownloader(root, version, maxConcurrency, 5, false);

downloader.on('progress', (percent) => {
  console.log(`Progreso: ${percent}%`);
});

downloader.on('done', ({ totalAssets }) => {
  console.log(`Todos los assets descargados. Total de assets: ${totalAssets}`);
});

downloader.on('warn', (msg) => console.warn('Advertencia:', msg));
downloader.on('error', (err) => console.error('Error:', err));

downloader.start();
