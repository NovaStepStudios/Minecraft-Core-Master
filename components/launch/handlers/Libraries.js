"use strict";
const fs = require('fs');
const path = require('path');
const os = require('os');
const Download = require('../utils/Download');

const platform = os.platform();

const isAllowed = (rules) => {
  if (!rules) return true;
  for (const rule of rules) {
    const allow = rule.action === 'allow';
    const osRule = rule.os?.name;
    if (!osRule || osRule === platform) return allow;
  }
  return false;
};

const getLibPath = (lib, classifier = null, ext = 'jar') => {
  const parts = lib.name.split(':'); // [group, name, version]
  const groupPath = parts[0].replace(/\./g, '/');
  const baseName = classifier
    ? `${parts[1]}-${parts[2]}-${classifier}.${ext}`
    : `${parts[1]}-${parts[2]}.${ext}`;
  return path.join(groupPath, parts[1], parts[2], baseName);
};

// Para librerías que solo son URLs (extras), parseamos la URL para armar la ruta
const getMaven2PathFromURL = (url) => {
  try {
    const urlObj = new URL(url);
    const mavenIndex = urlObj.pathname.indexOf('/maven2/');
    if (mavenIndex === -1) return null;
    const relPath = urlObj.pathname.substring(mavenIndex + '/maven2/'.length);
    return relPath;
  } catch {
    return null;
  }
};

// Función recursiva para juntar todas las librerías heredadas
async function gatherLibraries(root, versionId) {
  const versionJsonPath = path.join(root, 'versions', versionId, `${versionId}.json`);

  if (!fs.existsSync(versionJsonPath)) {
    // Intentar fallback para loaders o versiones que no tienen JSON propio
    // Por ejemplo, si versionId es 'quilt-loader-0.29.1-1.20', intentar '1.20'
    console.warn(`[libraries.js] No existe JSON para la versión ${versionId}, intentando fallback...`);

    // Intentar extraer una versión base de versionId, asumiendo formato usual 'modname-version-baseversion'
    const fallbackVersion = (() => {
      const parts = versionId.split('-');
      // Buscar la parte que parezca versión base (último elemento, o elementos finales que parecen versión Minecraft)
      // Ejemplo simple: tomar el último segmento si contiene números y puntos
      for (let i = parts.length - 1; i >= 0; i--) {
        if (/^\d+(\.\d+)*$/.test(parts[i])) return parts[i];
      }
      // Si no encuentra fallback válido, devolver null
      return null;
    })();

    if (fallbackVersion) {
      const fallbackPath = path.join(root, 'versions', fallbackVersion, `${fallbackVersion}.json`);
      if (fs.existsSync(fallbackPath)) {
        console.log(`[libraries.js] Usando fallback versión base ${fallbackVersion}`);
        const fallbackData = JSON.parse(fs.readFileSync(fallbackPath, 'utf-8'));
        let libs = fallbackData.libraries || [];

        if (fallbackData.inheritsFrom) {
          const parentLibs = await gatherLibraries(root, fallbackData.inheritsFrom);
          const allLibsMap = new Map();
          for (const lib of parentLibs) allLibsMap.set(lib.name, lib);
          for (const lib of libs) allLibsMap.set(lib.name, lib);
          libs = Array.from(allLibsMap.values());
        }

        return libs;
      }
    }

    throw new Error(`No existe el JSON de la versión ${versionId} ni fallback posible`);
  }

  const versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'));

  let libs = versionData.libraries || [];

  if (versionData.inheritsFrom) {
    const parentLibs = await gatherLibraries(root, versionData.inheritsFrom);
    // Unir las librerías del padre con las propias (sin duplicados)
    const allLibsMap = new Map();
    for (const lib of parentLibs) allLibsMap.set(lib.name, lib);
    for (const lib of libs) allLibsMap.set(lib.name, lib);
    libs = Array.from(allLibsMap.values());
  }

  return libs;
}

module.exports = {
  async validate(root, versionData, extraLibs = []) {
    // Usar la función recursiva para juntar todas las librerías (padres + actual)
    const libs = await gatherLibraries(root, versionData.id);
    const libDir = path.join(root, 'libraries');
    const maven2Dir = path.join(libDir, 'maven2');

    // Unimos libs oficiales + extraLibs (extraLibs son URLs)
    // extraLibs pueden ser URLs directas a Maven Central, se colocarán en maven2/
    const allLibs = [...libs, ...extraLibs.map(url => ({ url }))];

    for (const lib of allLibs) {
      if (lib.name) {
        if (!isAllowed(lib.rules)) continue;

        if (lib.downloads?.artifact) {
          const libPath = getLibPath(lib);
          const fullPath = path.join(libDir, libPath);
          if (!fs.existsSync(fullPath)) {
            await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
            await Download.fromURL(lib.downloads.artifact.url, fullPath);
          }
        }

        if (lib.downloads?.classifiers) {
          for (const [classifier, info] of Object.entries(lib.downloads.classifiers)) {
            if (!info || !info.url) continue;
            let ext = 'jar';
            if (info.path && typeof info.path === 'string') {
              ext = path.extname(info.path).slice(1) || 'jar';
            }
            const libPath = getLibPath(lib, classifier, ext);
            const fullPath = path.join(libDir, libPath);
            if (!fs.existsSync(fullPath)) {
              await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
              await Download.fromURL(info.url, fullPath);
            }
          }
        }
      } else if (lib.url) {
        const relPath = getMaven2PathFromURL(lib.url);
        if (!relPath) {
          console.warn(`[libraries.js] URL no válida o no Maven2: ${lib.url}`);
          continue;
        }
        const fullPath = path.join(maven2Dir, relPath);
        if (!fs.existsSync(fullPath)) {
          await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
          await Download.fromURL(lib.url, fullPath);
        }
      }
    }
  }
};
