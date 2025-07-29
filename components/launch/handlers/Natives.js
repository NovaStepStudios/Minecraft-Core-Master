"use strict";
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const os = require('os');
const unzipper = require('unzipper');
const Download = require('../utils/Download');

const platformMap = {
  win32: 'windows',
  linux: 'linux',
  darwin: 'osx',
};

const getNativeClassifier = () => {
  const platform = platformMap[os.platform()];
  const arch = os.arch();

  if (!platform) return null;

  if (platform === 'windows') {
    if (arch === 'x64' || arch === 'arm64') return 'natives-windows';
    if (arch === 'ia32') return 'natives-windows-32';
  }

  if (platform === 'linux') {
    if (arch === 'x64' || arch === 'arm64') return 'natives-linux';
    if (arch === 'ia32') return 'natives-linux-32';
  }

  if (platform === 'osx') {
    return 'natives-osx';
  }

  return null;
};

const getLibPath = (name, classifier, ext = 'jar') => {
  if (typeof name !== 'string') {
    throw new Error(`[Natives] getLibPath recibió name no string: ${JSON.stringify(name)}`);
  }
  const [group, lib, version] = name.split(':');
  const groupPath = group.replace(/\./g, '/');
  const fileName = classifier ? `${lib}-${version}-${classifier}.${ext}` : `${lib}-${version}.${ext}`;
  return path.join(groupPath, lib, version, fileName);
};

async function loadVersionTree(root, versionID, visited = new Set()) {
  if (visited.has(versionID)) {
    throw new Error(`[Natives] Dependencia cíclica detectada en inheritsFrom: ${versionID}`);
  }
  visited.add(versionID);

  const versionJsonPath = path.join(root, 'versions', versionID, `${versionID}.json`);

  if (!(await fs.stat(versionJsonPath).catch(() => false))) {
    throw new Error(`[Natives] No se encontró JSON de versión: ${versionJsonPath}`);
  }

  const json = JSON.parse(await fs.readFile(versionJsonPath, 'utf-8'));

  // Si inheritsFrom no es string válido, ignorar herencia
  if (!json.inheritsFrom || typeof json.inheritsFrom !== 'string') {
    return json;
  }

  // Llamada recursiva para herencia
  const parentJson = await loadVersionTree(root, json.inheritsFrom, visited);

  const parentLibs = Array.isArray(parentJson.libraries) ? parentJson.libraries.filter(lib => typeof lib.name === 'string') : [];
  const childLibs = Array.isArray(json.libraries) ? json.libraries.filter(lib => typeof lib.name === 'string') : [];

  const childLibsMap = new Map(childLibs.map(lib => [lib.name, lib]));

  const combinedLibs = [
    ...parentLibs.filter(lib => !childLibsMap.has(lib.name)),
    ...childLibs,
  ];

  return {
    ...json,
    libraries: combinedLibs,
  };
}

module.exports = {
  async setup(root, versionID) {
    // Carga la versión y sus herencias con protección ante herencias cíclicas y tipos inválidos
    const versionData = await loadVersionTree(root, versionID);

    const nativesDir = path.join(root, 'natives', versionData.id);
    await fs.mkdir(nativesDir, { recursive: true });

    const classifier = getNativeClassifier();
    if (!classifier) {
      throw new Error(`[Natives] Plataforma no compatible: ${os.platform()} (${os.arch()})`);
    }

    const libs = Array.isArray(versionData.libraries) ? versionData.libraries : [];

    for (const lib of libs) {
      if (typeof lib.name !== 'string') {
        console.warn(`[Natives] Librería sin nombre válido, ignorando:`, lib);
        continue;
      }

      const nativeKey = lib.natives?.[platformMap[os.platform()]];
      const nativeInfo = lib.downloads?.classifiers?.[classifier];

      if (!nativeKey || !nativeInfo) continue;

      let nativePath;
      try {
        nativePath = getLibPath(lib.name, classifier);
      } catch (err) {
        console.warn(`[Natives] Error obteniendo ruta para librería: ${lib.name}`, err);
        continue;
      }

      const fullPath = path.join(root, 'libraries', nativePath);

      if (!(await fs.stat(fullPath).catch(() => false))) {
        console.log(`[Natives] Descargando: ${nativeInfo.url}`);
        await fs.mkdir(path.dirname(fullPath), { recursive: true });
        await Download.fromURL(nativeInfo.url, fullPath);
        console.log(`[Natives] Descargado en: ${fullPath}`);
      } else {
        console.log(`[Natives] Ya existe: ${fullPath}`);
      }

      await new Promise((resolve, reject) => {
        const extractStream = unzipper.Parse();

        extractStream.on('entry', (entry) => {
          const fileName = entry.path;
          const ext = path.extname(fileName).toLowerCase();

          const isNativeFile = ['.dll', '.so', '.dylib', '.jnilib', '.jar'].includes(ext);
          const isWrongArch = fileName.includes('-arm64') || fileName.includes('-x86') || fileName.includes('-windows-32');

          if (!isNativeFile || isWrongArch) {
            entry.autodrain();
            return;
          }

          const destPath = path.join(nativesDir, fileName);
          fs.mkdir(path.dirname(destPath), { recursive: true })
            .then(() => {
              const writeStream = fsSync.createWriteStream(destPath);
              entry.pipe(writeStream);
              writeStream.on('close', () => {});
              writeStream.on('error', err => {
                entry.autodrain();
                reject(err);
              });
            })
            .catch(err => {
              entry.autodrain();
              reject(err);
            });
        });

        extractStream.on('close', () => {
          console.log(`[Natives] Extracción completada para ${fullPath}`);
          resolve();
        });

        extractStream.on('error', e => {
          console.error(`[Natives] Error extrayendo ${fullPath}:`, e);
          reject(e);
        });

        fsSync.createReadStream(fullPath).pipe(extractStream);
      });
    }

    const files = await fs.readdir(nativesDir).catch(() => []);
    console.log(`[Natives] Archivos extraídos en ${nativesDir}:`, files);

    return nativesDir;
  }
};
