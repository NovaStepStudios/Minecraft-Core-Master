const assetsDownloader = require("../components/download/downloaders/assetsDownloader.js");

const downloader = assetsDownloader(".steplauncher", "1.20.4");

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
