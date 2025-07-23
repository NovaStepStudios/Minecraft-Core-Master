const fs = require('fs');
const path = require('path');
const https = require('https');
const { fromURL } = require('../utils/Download');

const ASSET_BASE = 'https://resources.download.minecraft.net';

async function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

// Copiar carpeta icons recursivamente, pero sin sobrescribir archivos ya existentes
async function copyIconsIfMissing(src, dest) {
  const entries = await fs.promises.readdir(src, { withFileTypes: true });
  await fs.promises.mkdir(dest, { recursive: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyIconsIfMissing(srcPath, destPath);
    } else {
      // Solo copiar si no existe en destino
      if (!fs.existsSync(destPath)) {
        await fs.promises.copyFile(srcPath, destPath);
      }
    }
  }
}

module.exports = {
  async setup(root, versionData) {
    const assetsID = versionData.assets || versionData.assetIndex.id;
    const assetsDir = path.join(root, 'assets');
    const indexesDir = path.join(assetsDir, 'indexes');
    const objectsDir = path.join(assetsDir, 'objects');
    const virtualDir = path.join(assetsDir, 'legacy', 'virtual');
    const resourcesDir = path.join(root, 'resources');

    const indexURL = versionData.assetIndex?.url ||
      `https://resources.download.minecraft.net/indexes/${assetsID}.json`;
    const indexPath = path.join(indexesDir, `${assetsID}.json`);

    // 1. Crear carpetas necesarias
    await fs.promises.mkdir(indexesDir, { recursive: true });
    await fs.promises.mkdir(objectsDir, { recursive: true });
    await fs.promises.mkdir(virtualDir, { recursive: true });
    await fs.promises.mkdir(resourcesDir, { recursive: true });

    // 2. Descargar index si no existe
    if (!fs.existsSync(indexPath)) {
      await fromURL(indexURL, indexPath);
    }

    // 3. Leer JSON del índice
    const indexJSON = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));
    const objects = indexJSON.objects;

    for (const [logicalPath, data] of Object.entries(objects)) {
      const hash = data.hash;
      const subdir = hash.substring(0, 2);
      const objectPath = path.join(objectsDir, subdir, hash);
      const downloadURL = `${ASSET_BASE}/${subdir}/${hash}`;

      // Crear subcarpeta y descargar si falta
      if (!fs.existsSync(objectPath)) {
        await fs.promises.mkdir(path.dirname(objectPath), { recursive: true });
        await fromURL(downloadURL, objectPath);
      }

      // Desvirtualizar en /resources/
      const resourceTarget = path.join(resourcesDir, logicalPath);
      if (!fs.existsSync(resourceTarget)) {
        await fs.promises.mkdir(path.dirname(resourceTarget), { recursive: true });
        await fs.promises.copyFile(objectPath, resourceTarget);
      }

      // Desvirtualizar en /assets/legacy/virtual/legacy/
      const legacyTarget = path.join(virtualDir, logicalPath);
      if (!fs.existsSync(legacyTarget)) {
        await fs.promises.mkdir(path.dirname(legacyTarget), { recursive: true });
        await fs.promises.copyFile(objectPath, legacyTarget);
      }
    }

    // Copiar icons solo si no existen en destino (para no romper sonido u otros recursos)
    const srcIcons = path.join(resourcesDir, 'icons');
    const destIcons = path.join(assetsDir, 'icons');

    if (fs.existsSync(srcIcons)) {
      await copyIconsIfMissing(srcIcons, destIcons);
    }
  }
};
