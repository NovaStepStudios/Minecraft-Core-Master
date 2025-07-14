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
  const baseName = classifier ? `${parts[1]}-${parts[2]}-${classifier}.${ext}` : `${parts[1]}-${parts[2]}.${ext}`;
  return path.join(groupPath, parts[1], parts[2], baseName);
};

// Función recursiva para juntar todas las librerías heredadas
async function gatherLibraries(root, versionId) {
  const versionJsonPath = path.join(root, 'versions', versionId, `${versionId}.json`);
  if (!fs.existsSync(versionJsonPath)) {
    throw new Error(`No existe el JSON de la versión ${versionId}`);
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
  async validate(root, versionData) {
    // Usar la función recursiva para juntar todas las librerías (padres + actual)
    const libs = await gatherLibraries(root, versionData.id);
    const libDir = path.join(root, 'libraries');

    for (const lib of libs) {
      if (!isAllowed(lib.rules)) continue;

      // Priorizar artifact
      if (lib.downloads?.artifact) {
        const libPath = getLibPath(lib);
        const fullPath = path.join(libDir, libPath);
        if (!fs.existsSync(fullPath)) {
          await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
          await Download.fromURL(lib.downloads.artifact.url, fullPath);
        }
      }

      // También validar classifiers (ej: natives, classifiers.jar, etc)
      if (lib.downloads?.classifiers) {
        for (const [classifier, info] of Object.entries(lib.downloads.classifiers)) {
          const ext = path.extname(info.path).slice(1) || 'jar';
          const libPath = getLibPath(lib, classifier, ext);
          const fullPath = path.join(libDir, libPath);
          if (!fs.existsSync(fullPath)) {
            await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
            await Download.fromURL(info.url, fullPath);
          }
        }
      }
    }
  }
};
