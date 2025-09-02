const path = require('path');
const { MrpackExtractor } = require('../../dist/index');

async function main() {
  const extractor = new MrpackExtractor();

  // Escuchamos los eventos
  extractor.on('progress', (progress) => {
    console.log(`Progreso: ${progress}`);
  });

  extractor.on('fileName', (msg) => {
    console.log('Archivo :',msg);
  });

  extractor.on('done', () => {
    console.log('Modpack instalado correctamente.');
  });

  extractor.on('error', (err) => {
    console.error('Error detectado:', err.message, context);
  });

  extractor.on('retry', (file) => {
    console.log(`Reintentando descarga: ${file}`);
  });

  try {
    await extractor.extract({
      root: './.minecraft',
      filePath: path.join(__dirname, 'FileTest/Reimagined Intro 1.21.4.mrpack'),
      keepMrpack: true,  // opcional
      concurry: 5,       // descargas paralelas
      recursive: true,   // sobrescribir archivos si existen
      verify: true       // verificar SHA
    });
  } catch (err) {
    console.error('Fallo grave durante la instalación del modpack:', err);
  }
}

main();
