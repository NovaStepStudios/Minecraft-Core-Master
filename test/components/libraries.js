const { MinecraftLibrariesDownloader } = require('../../dist/handlers/download/Handlers/Libraries');

const root = './minecraft';       // Carpeta donde se guardarán los nativos
const version = '1.21.8';         // Versión de Minecraft
const maxConcurrency = 20;         // Descargas simultáneas
const maxRetries = 5;              // Reintentos por archivo
const overwrite = false;           // Sobrescribir archivos existentes

// Crear downloader con los parámetros correctos según tu clase
const downloader = new MinecraftLibrariesDownloader(root, version, overwrite, maxConcurrency, maxRetries);

// Escuchar progreso
downloader.on('progress', (progress) => {
  console.log(`Progreso: ${progress.percent}% (${progress.current}/${progress.total})`);
});

// Cuando se terminen todos los nativos
downloader.on('done', ({ current, total }) => {
  console.log(`Descarga completada: ${total} Libraries.`);
});

// Logs y advertencias
downloader.on('warn', (msg) => console.warn('Advertencia:', msg));
downloader.on('error', (err) => console.error('Error:', err));

// Iniciar descarga
downloader.start();
