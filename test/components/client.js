const { MinecraftClientDownloader } = require('../../dist/handlers/download/Handlers/Client');

const root = './minecraft';       // Carpeta donde se guardarán los nativos
const version = '1.21.8';         // Versión de Minecraft

// Crear downloader con los parámetros correctos según tu clase
const downloader = new MinecraftClientDownloader(root, version);

// Escuchar progreso
downloader.on('progress', (progress) => {
  console.log(`Progreso: ${progress.percent}%`);
});

downloader.on('done', () => {
  console.log(`Descarga completada: Cliente.`);
});

// Logs y advertencias
downloader.on('warn', (msg) => console.warn('Advertencia:', msg));
downloader.on('error', (err) => console.error('Error:', err));

// Iniciar descarga
downloader.start();