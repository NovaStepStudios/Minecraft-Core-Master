"use strict";
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
  let result = null;
  for (const rule of rules) {
    const matchOS = !rule.os || rule.os.name === normalizeOS;
    if (matchOS) {
      result = rule.action === 'allow';
    }
  }
  return result !== null ? result : false;
};

const getLibPath = (lib, classifier = null, ext = 'jar') => {
  if (!lib.name) return null;
  const [group, name, version] = lib.name.split(':');
  if (!group || !name || !version) return null;
  const groupPath = group.replace(/\./g, '/');
  const baseName = classifier ? `${name}-${version}-${classifier}.${ext}` : `${name}-${version}.jar`;
  return path.join(groupPath, name, version, baseName);
};

const findFinalJarVersionID = (root, startID) => {
  let currentID = startID;
  let lastValidID = null;

  while (true) {
    const jsonPath = path.join(root, 'versions', currentID, `${currentID}.json`);
    const jarPath = path.join(root, 'versions', currentID, `${currentID}.jar`);

    if (!fs.existsSync(jsonPath) || !fs.existsSync(jarPath)) {
      // Si no existe el JSON o el JAR para esta versión, salimos
      break;
    }

    lastValidID = currentID;

    try {
      const json = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      if (!json.inheritsFrom) break; // No hay versión padre, esta es la final
      currentID = json.inheritsFrom;
    } catch (e) {
      console.warn(`[Classpath] Error leyendo ${jsonPath}: ${e.message}`);
      break;
    }
  }

  if (!lastValidID) {
    throw new Error(`[Classpath] No se encontró versión base con JSON y JAR para: ${startID}`);
  }
  return lastValidID;
};


const mergeInheritedLibraries = (root, versionData) => {
  let merged = [...(versionData.libraries || [])];
  let currentID = versionData.inheritsFrom;
  while (currentID) {
    const jsonPath = path.join(root, 'versions', currentID, `${currentID}.json`);
    if (!fs.existsSync(jsonPath)) break;
    try {
      const parent = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      merged = [...(parent.libraries || []), ...merged];
      currentID = parent.inheritsFrom;
    } catch (e) {
      console.warn(`[Classpath] Error leyendo ${jsonPath}: ${e.message}`);
      break;
    }
  }
  return merged;
};

const filterIncompatibleLibs = (libs, versionID) => {
  const isForge1710 = versionID.includes('1.7.10') && libs.some(l => l.name?.includes('forge'));
  if (!isForge1710) return libs;
  return libs.filter(lib => {
    if (!lib.name) return true;
    if (lib.name.startsWith('com.google.guava:guava:')) {
      const version = lib.name.split(':')[2];
      const major = parseInt(version.split('.')[0]);
      return major <= 17;
    }
    return true;
  });
};

const tryAddLib = (libPath, classPathSet, classPath) => {
  if (fs.existsSync(libPath)) {
    const absPath = path.resolve(libPath);
    if (!classPathSet.has(absPath)) {
      classPathSet.add(absPath);
      classPath.push(absPath);
    }
  } else {
    console.warn(`[Classpath] Archivo no encontrado: ${libPath}`);
  }
};

const addFilteredMaven2Jars = (maven2Dir, classPathSet, classPath, whitelist = []) => {
  if (!fs.existsSync(maven2Dir)) return;
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.jar')) {
        if (whitelist.length === 0 || whitelist.some(keyword => entry.name.includes(keyword))) {
          tryAddLib(fullPath, classPathSet, classPath);
        }
      }
    }
  };
  walk(maven2Dir);
};

const resolveLibPath = (libDir, maven2Dir, lib) => {
  const candidates = [];
  if (lib.downloads?.classifiers?.jar?.path)
    candidates.push(lib.downloads.classifiers.jar.path);
  if (lib.downloads?.artifact?.path)
    candidates.push(lib.downloads.artifact.path);
  if (lib.name)
    candidates.push(getLibPath(lib));

  for (const relPath of candidates) {
    const fromLibs = path.join(libDir, relPath);
    if (fs.existsSync(fromLibs)) return fromLibs;
    const fromMaven = path.join(maven2Dir, relPath);
    if (fs.existsSync(fromMaven)) return fromMaven;
  }
  return null;
};

module.exports = {
  /**
   * Construye el classpath y module-path (si es necesario) para la versión dada.
   * @param {string} root Root folder del launcher
   * @param {object} versionData JSON con datos de versión
   * @returns {object} { classPath: string[], modulePath: string[] }
   */
  async build(root, versionData) {
    const classPath = [];
    const modulePath = [];
    const libDir = path.join(root, 'libraries');
    const maven2Dir = path.join(root, 'maven2');

    let libs = mergeInheritedLibraries(root, versionData);
    libs = filterIncompatibleLibs(libs, versionData.id);
    libs = libs.filter(lib => isAllowed(lib.rules));

    const isForge1710 = versionData.id.includes('1.7.10') && libs.some(l => l.name?.includes('forge'));
    const classPathSet = new Set();

    // Forzar Guava 17.0 en Forge 1.7.10
    if (isForge1710) {
      const guavaForcedPath = path.resolve(libDir, 'maven2/com/google/guava/guava/17.0/guava-17.0.jar');
      if (fs.existsSync(guavaForcedPath)) {
        tryAddLib(guavaForcedPath, classPathSet, classPath);
        console.log('[Classpath] Guava 17.0 forzada para Forge 1.7.10');
      } else {
        console.warn(`[Classpath] guava-17.0.jar no encontrada en: ${guavaForcedPath}`);
      }
    }

    // Añadir librerías filtradas en orden
    for (const lib of libs) {
      if (isForge1710 && lib.name?.startsWith('com.google.guava:guava:')) continue;
      const libPath = resolveLibPath(libDir, maven2Dir, lib);
      if (!libPath) {
        console.warn(`[Classpath] No se pudo resolver path para: ${lib.name || '[sin nombre]'}`);
        continue;
      }
      tryAddLib(libPath, classPathSet, classPath);
    }

    // Añadir jopt-simple con fallback
    const joptVersions = ['4.6', '4.5'];
    let joptFound = false;
    for (const ver of joptVersions) {
      const joptPath = path.resolve(libDir, `net/sf/jopt-simple/jopt-simple/${ver}/jopt-simple-${ver}.jar`);
      if (fs.existsSync(joptPath)) {
        tryAddLib(joptPath, classPathSet, classPath);
        joptFound = true;
        break;
      }
    }
    if (!joptFound) console.warn('[Classpath] jopt-simple no encontrado');

    // Añadir log4j prioritario
    const log4jCandidates = [
      ['2.17.1', 'log4j-api'],
      ['2.17.1', 'log4j-core'],
      ['2.0-beta9', 'log4j-api'],
      ['2.0-beta9', 'log4j-core'],
    ];
    let log4jAdded = false;
    for (const [ver, name] of log4jCandidates) {
      const jarRelPath = `org/apache/logging/log4j/${name}/${ver}/${name}-${ver}.jar`;
      const jarFullPath = path.resolve(libDir, jarRelPath);
      if (fs.existsSync(jarFullPath)) {
        tryAddLib(jarFullPath, classPathSet, classPath);
        log4jAdded = true;
      }
    }
    if (!log4jAdded) console.warn('[Classpath] Ningún log4j encontrado');

    // Añadir jar base de la versión final
    const finalVersionID = findFinalJarVersionID(root, versionData.id);
    const jarPath = path.resolve(root, 'versions', finalVersionID, `${finalVersionID}.jar`);
    if (!fs.existsSync(jarPath)) {
      throw new Error(`[Classpath] No se encontró el jar base: ${jarPath}`);
    }
    tryAddLib(jarPath, classPathSet, classPath);

    // Detección automática para incluir jars maven2:
    const modLoadersKeywords = ['forge', 'neoforge', 'fabric', 'liteloader', 'fml', 'quilt'];
    const usesModLoader = libs.some(lib =>
      lib.name && modLoadersKeywords.some(keyword => lib.name.toLowerCase().includes(keyword))
    );

    if (usesModLoader) {
      const whitelist = ['guava', 'log4j', 'jopt-simple', 'asm', 'objenesis', 'fastutil'];
      addFilteredMaven2Jars(maven2Dir, classPathSet, classPath, whitelist);
      console.log(`[Classpath] Añadidos jars maven2 filtrados automáticamente para mod loaders`);
    } else {
      console.log(`[Classpath] No se detectaron mod loaders, no se añaden jars maven2`);
    }

    // === NeoForge Module-Path Handling ===
    const neoforgeKeywords = ['neoforge', 'fmlcore', 'fmlcore-mod'];
    if (libs.some(lib => lib.name?.toLowerCase().includes('neoforge'))) {
      console.log('[Classpath] Detección de NeoForge activa, procesando module-path...');
      for (const libPath of classPath.slice()) {
        const filename = path.basename(libPath).toLowerCase();
        if (neoforgeKeywords.some(keyword => filename.includes(keyword))) {
          modulePath.push(libPath);
          classPathSet.delete(libPath);
          const index = classPath.indexOf(libPath);
          if (index !== -1) classPath.splice(index, 1);
          console.log(`[Classpath] Moviendo a module-path: ${filename}`);
        }
      }
    }

    console.log(`[Classpath] Total librerías en classpath: ${classPath.length}`);
    console.log(`[Classpath] Total librerías en module-path: ${modulePath.length}`);

    return { classPath, modulePath };
  }
};
