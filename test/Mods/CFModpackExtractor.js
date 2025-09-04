const path = require('path');
const { CFModpackExtractor } = require('../../dist/Minecraft-Mods/CurseforgeModpack');

async function main() {
  const extractor = new CFModpackExtractor();

  // --- EVENTOS ---
  extractor.on('progress', (file, percent) => {
    console.log(`[PROGRESS] ${file} | ${percent}%`);
  });

  extractor.on('fileName', (name) => {
    console.log(`[FILE] ${name} descargado.`);
  });

  extractor.on('retry', (file) => {
    console.log(`[RETRY] Reintentando: ${file}`);
  });

  extractor.on('errors', (err) => {
    console.error(`[ERROR]`, err.message);
  });

  extractor.on('done', () => {
    console.log('[DONE] Modpack instalado correctamente.');
  });

  // --- EXTRACTOR ---
  try {
    await extractor.extract({
      root: path.join(__dirname, '.minecrafttest'),          // carpeta donde se instalarán los mods
      filePath: path.join(__dirname, 'Builders Paradise-1.1.4/manifest.json'), // tu JSON de CurseForge
      concurry: 5,     // descargas paralelas
      recursive: true, // sobrescribir mods existentes
      keepJson: true,   // mantener el JSON original
      apiKey: "$2a$10$qTTQj5XMpnktjDQl2.2wWeJSHt9PKrh9didxDDlT73FcwwVCX.VRO",
    });
  } catch (err) {
    console.error('Fallo grave durante la instalación del modpack:', err);
  }
}

main();
