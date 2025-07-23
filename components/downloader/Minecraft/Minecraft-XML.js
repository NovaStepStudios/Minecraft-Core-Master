const https = require('https');
const fs = require('fs');
const path = require('path');

const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

function download(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`[Minecraft-Core-Master || Downloader] Failed to download ${url}, status code: ${res.statusCode}`));
        res.resume();
        return;
      }
      const data = [];
      res.on('data', chunk => data.push(chunk));
      res.on('end', () => resolve(Buffer.concat(data)));
    });

    req.on('error', reject);
    req.setTimeout(timeout, () => {
      req.destroy(new Error(`[Minecraft-Core-Master || Downloader] Request timeout after ${timeout}ms for ${url}`));
    });
  });
}

/**
 * Descarga el XML de logging para la versión dada, guarda el manifiesto en cache y el XML en disco.
 * Si no existe el logging XML o ocurre un error, simplemente se ignora.
 *
 * @param {string} versionId - versión de Minecraft (ej: '1.7.10')
 * @param {string} root - ruta raíz donde guardar archivos
 * @param {string} [outputFolder] - carpeta para guardar el XML de logging (por defecto: 'logging' dentro de root)
 * @returns {Promise<string|null>} ruta al archivo XML guardado, o `null` si no se descargó
 */
async function downloadLoggingXml(versionId, root, outputFolder = null) {
  if (!root) throw new Error('Se debe pasar el parámetro root');

  try {
    console.log(`[Minecraft-Core-Master || Downloader] Descargando manifiesto de versiones...`);
    const manifestData = await download(VERSION_MANIFEST_URL);
    const manifest = JSON.parse(manifestData.toString());

    // Guardar manifest en cache json
    const manifestCachePath = path.join(root, 'cache', 'json');
    if (!fs.existsSync(manifestCachePath)) fs.mkdirSync(manifestCachePath, { recursive: true });
    const manifestFile = path.join(manifestCachePath, 'manifest_v2.json');
    fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));
    console.log(`[Minecraft-Core-Master || Downloader] Manifest guardado en: ${manifestFile}`);

    const versionInfo = manifest.versions.find(v => v.id === versionId);
    if (!versionInfo) throw new Error(`Versión ${versionId} no encontrada en el manifiesto`);

    console.log(`[Minecraft-Core-Master || Downloader] Descargando JSON de la versión ${versionId}...`);
    const versionJsonData = await download(versionInfo.url);
    const versionJson = JSON.parse(versionJsonData.toString());

    if (!versionJson.logging?.client?.file) {
      console.log(`[Minecraft-Core-Master || Downloader] ⚠️ Versión ${versionId} no tiene logging XML. Saltando...`);
      return null;
    }

    const { url: xmlUrl, id: xmlName, size: xmlSize } = versionJson.logging.client.file;

    outputFolder = outputFolder || path.join(root, 'logging');
    if (!fs.existsSync(outputFolder)) {
      fs.mkdirSync(outputFolder, { recursive: true });
      console.log(`[Minecraft-Core-Master || Downloader] Directorio creado: ${outputFolder}`);
    }

    console.log(`[Minecraft-Core-Master || Downloader] Descargando archivo XML de logging: ${xmlName} desde ${xmlUrl}...`);
    const xmlData = await download(xmlUrl);

    // Validar tamaño esperado
    if (xmlData.length !== xmlSize) {
      console.log(`[Minecraft-Core-Master || Downloader] ⚠️ Tamaño del XML inesperado. Recibido: ${xmlData.length}, Esperado: ${xmlSize}. Saltando...`);
      return null;
    }

    const outputPath = path.join(outputFolder, xmlName);
    fs.writeFileSync(outputPath, xmlData);
    console.log(`[Minecraft-Core-Master || Downloader] ✅ Archivo XML guardado en: ${outputPath}`);

    return outputPath;
  } catch (error) {
    console.log(`[Minecraft-Core-Master || Downloader] ⚠️  Error al descargar logging XML para ${versionId}: ${error.message}`);
    console.log(`[Minecraft-Core-Master || Downloader] Continuando sin el archivo XML...`);
    return null;
  }
}

module.exports = {
  downloadLoggingXml,
};
