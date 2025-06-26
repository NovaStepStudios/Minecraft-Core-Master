const clientDownloader = require("../download/downloaders/clientDownloader");

const downloader = clientDownloader(".steplauncher", "1.20.4");

downloader.on('progress', percent => {
  console.log(`Progreso: ${percent}`);
});

downloader.on('done', () => {
  console.log('Descarga completada!');
});

downloader.on('error', err => {
  console.error('Error:', err);
});

downloader.start();
