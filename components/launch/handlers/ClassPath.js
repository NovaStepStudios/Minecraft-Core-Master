const path = require('path');
const fs = require('fs');
const os = require('os');

const currentOS = os.platform();

const normalizeOS = {
  win32: 'windows',
  darwin: 'osx',
  linux: 'linux',
}[currentOS] || currentOS;

const isAllowed = (rules) => {
  if (!rules) return true;

  let allowed = true;
  for (const rule of rules) {
    const action = rule.action === 'allow';
    const matchOS = !rule.os || rule.os.name === normalizeOS;
    if (matchOS) allowed = action;
  }

  return allowed;
};

const getLibPath = (lib) => {
  const [group, name, version] = lib.name.split(':');
  const groupPath = group.replace(/\./g, '/');
  return path.join(groupPath, name, version, `${name}-${version}.jar`);
};

// Encuentra la versión base final (sin herencia)
const findFinalJarVersionID = (root, startID) => {
  let currentID = startID;

  while (true) {
    const jsonPath = path.join(root, 'versions', currentID, `${currentID}.json`);
    if (!fs.existsSync(jsonPath)) break;

    const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    if (!json.inheritsFrom) break;

    currentID = json.inheritsFrom;
  }

  return currentID;
};
const mergeInheritedLibraries = (root, versionData) => {
  let merged = [...(versionData.libraries || [])];
  let currentID = versionData.inheritsFrom;

  while (currentID) {
    const jsonPath = path.join(root, 'versions', currentID, `${currentID}.json`);
    if (!fs.existsSync(jsonPath)) break;

    const parent = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
    merged = [...(parent.libraries || []), ...merged]; // Importante: el padre va primero
    currentID = parent.inheritsFrom;
  }

  return merged;
};
module.exports = {
  
  async build(root, versionData) {
    const classPath = [];
    const libDir = path.join(root, 'libraries');
    const libs = mergeInheritedLibraries(root, versionData);

    for (const lib of libs) {
      if (!isAllowed(lib.rules)) continue;

      let libPath = null;

      // Prioriza artifact, luego classifiers.jar, luego ruta construida manualmente
      if (lib.downloads?.artifact?.path) {
        libPath = path.join(libDir, lib.downloads.artifact.path);
      } else if (lib.downloads?.classifiers?.jar?.path) {
        libPath = path.join(libDir, lib.downloads.classifiers.jar.path);
      } else if (lib.name) {
        libPath = path.join(libDir, getLibPath(lib));
      }

      if (!libPath) {
        console.warn(`[Classpath] No se pudo resolver path para la librería: ${lib.name}`);
        continue;
      }

      if (fs.existsSync(libPath)) {
        const absolutePath = path.resolve(libPath);
        if (!classPath.includes(absolutePath)) {
          classPath.push(absolutePath);
        }
      } else {
        console.warn(`[Classpath] Archivo no encontrado: ${libPath}`);
      }
    }

    // Añadir explícitamente jopt-simple (versión para MC 1.12.2 usualmente 4.6)
    const joptsimplePath = path.resolve(
      libDir,
      'net/sf/jopt-simple/jopt-simple/4.6/jopt-simple-4.6.jar'
    );
    if (fs.existsSync(joptsimplePath) && !classPath.includes(joptsimplePath)) {
      classPath.push(joptsimplePath);
    } else {
      console.warn(`[Classpath] jopt-simple no encontrado en: ${joptsimplePath}`);
    }

    // Añadir log4j (para seguridad en versiones antiguas)
    const log4jLibs = [
      'org/apache/logging/log4j/log4j-api/2.17.1/log4j-api-2.17.1.jar',
      'org/apache/logging/log4j/log4j-core/2.17.1/log4j-core-2.17.1.jar',
    ];

    for (const jarRelPath of log4jLibs) {
      const fullPath = path.resolve(libDir, jarRelPath);
      if (fs.existsSync(fullPath) && !classPath.includes(fullPath)) {
        classPath.push(fullPath);
      } else {
        console.warn(`[Classpath] Log4j no encontrado en: ${fullPath}`);
      }
    }

    // Añadir jar base final de la versión
    const finalVersionID = findFinalJarVersionID(root, versionData.id);
    const jarPath = path.resolve(root, 'versions', finalVersionID, `${finalVersionID}.jar`);

    if (!fs.existsSync(jarPath)) {
      throw new Error(`[Classpath] No se encontró el archivo JAR del cliente base: ${jarPath}`);
    }

    classPath.push(jarPath);

    return classPath;
  }
};
