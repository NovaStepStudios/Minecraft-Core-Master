const { MinecraftNativesDownloader } = require('../../dist/handlers/download/Handlers/Natives');

const root = './minecraft'; // Carpeta donde se guardarán los assets
const version = '1.12.2';   // Versión de Minecraft a descargar
const maxConcurrency = 20;   // Cantidad máxima de descargas simultáneas

const downloader = new MinecraftNativesDownloader(root, version, maxConcurrency, 5, false);

downloader.on('progress', (percent) => {
  console.log(`Progreso: ${percent}%`);
});

downloader.on('done', ({ percent }) => {
  console.log(`Todos los Nativos descargados.`);
});

downloader.on('warn', (msg) => console.warn('Advertencia:', msg));
downloader.on('error', (err) => console.error('Error:', err));

downloader.start();
