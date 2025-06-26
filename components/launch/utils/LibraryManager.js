const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const unzipper = require("unzipper");

class LibraryManager {
  constructor(root, versionData, platform, options = {}) {
    this.root = root;
    this.versionData = versionData;
    this.platform = platform;
    this.options = options;

    this.cache = new Map();
    this.extractedNatives = new Set();
    this._checkedPaths = new Map();
    this._resolvedLibs = new Map();
  }

  _debug(...args) {
    if (this.options.debug) console.log("[LibraryManager]", ...args);
  }

  _arch() {
    const arch = process.arch;
    return arch === "x64" || arch === "arm64" ? "64" : arch;
  }

  async buildClasspath() {
    const classpathPaths = [];
    const extractionTasks = [];

    for (const lib of this.versionData.libraries || []) {
      if (!this._checkRules(lib)) continue;

      const artifactPath = await this._resolveLibraryPath(lib);
      if (artifactPath) classpathPaths.push(artifactPath);

      if (lib.natives?.[this.platform]) {
        extractionTasks.push(this._extractNative(lib));
      }
    }

    await Promise.all(extractionTasks);

    const vId = this.versionData.id || this.versionData.inheritsFrom;
    const clientJar = path.join(this.root, "versions", vId, `${vId}.jar`);

    if (await this._exists(clientJar)) {
      classpathPaths.push(clientJar);
    } else {
      this._debug(`Jar cliente no encontrado: ${clientJar}`);
    }

    const validPaths = [];
    for (const p of classpathPaths) {
      if (await this._exists(p)) validPaths.push(p);
      else this._debug(`Librería omitida (no existe): ${p}`);
    }

    this.cache.set(vId, validPaths);
    const sep = process.platform === "win32" ? ";" : ":";
    this._debug(`✔️ ${validPaths.length} librerías válidas encontradas.`);
    return validPaths.join(sep);
  }

  async _resolveLibraryPath(lib) {
    if (this._resolvedLibs.has(lib.name)) return this._resolvedLibs.get(lib.name);

    const downloadPath = lib.downloads?.artifact?.path;
    if (downloadPath) {
      const candidate = path.join(this.root, "libraries", downloadPath);
      if (await this._exists(candidate)) {
        this._resolvedLibs.set(lib.name, candidate);
        return candidate;
      }
    }

    const [group, artifact, versionRaw] = lib.name.split(":");
    if (!group || !artifact || !versionRaw) return null;

    const groupPath = group.replace(/\./g, path.sep);
    const jarName = `${artifact}-${versionRaw}.jar`;
    const fullPath = path.join(this.root, "libraries", groupPath, artifact, versionRaw, jarName);

    if (await this._exists(fullPath)) {
      this._resolvedLibs.set(lib.name, fullPath);
      return fullPath;
    }

    const cleanVersion = versionRaw.split("-")[0];
    const fallbackJar = `${artifact}-${cleanVersion}.jar`;
    const fallbackPath = path.join(this.root, "libraries", groupPath, artifact, cleanVersion, fallbackJar);

    if (await this._exists(fallbackPath)) {
      this._resolvedLibs.set(lib.name, fallbackPath);
      return fallbackPath;
    }

    this._debug(`Archivo de librería no encontrado: ${lib.name}`);
    return null;
  }

  async _extractNative(lib) {
    let classifier = lib.natives[this.platform];
    classifier = classifier.replace("${arch}", this._arch());
    const nativePath = this._getClassifierPath(lib, classifier);

    if (this.extractedNatives.has(nativePath)) return;
    if (!(await this._exists(nativePath))) return;

    const id = this.versionData.id || this.versionData.inheritsFrom;
    const extractDir = path.join(this.root, "natives", `${id}-${lib.name.replace(/[:.]/g, "_")}`);
    const lockFile = path.join(extractDir, ".extracted");

    if (!this.options.forceExtract && await this._exists(lockFile)) {
      this._debug(`Nativo ya marcado como extraído: ${extractDir}`);
      this.extractedNatives.add(nativePath);
      return;
    }

    await fs.mkdir(extractDir, { recursive: true });
    this._debug(`Extrayendo nativo: ${nativePath} → ${extractDir}`);

    await new Promise((resolve, reject) => {
      fsSync.createReadStream(nativePath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .on("close", resolve)
        .on("error", reject);
    });

    await fs.writeFile(lockFile, "ok");
    this.extractedNatives.add(nativePath);
    this._debug(`Extracción completada: ${extractDir}`);
  }

  _getClassifierPath(lib, classifier) {
    const classifierPath = lib.downloads?.classifiers?.[classifier]?.path;
    if (classifierPath) {
      return path.join(this.root, "libraries", classifierPath);
    }

    const [group, artifact, version] = lib.name.split(":");
    const groupPath = group.replace(/\./g, path.sep);
    const jarName = `${artifact}-${version}-${classifier}.jar`;
    return path.join(this.root, "libraries", groupPath, artifact, version, jarName);
  }

  _checkRules(lib) {
    if (!lib.rules || lib.rules.length === 0) return true;
    return lib.rules.reduce((allowed, rule) => {
      if (!rule.os || rule.os.name === this.platform) {
        return rule.action === "allow";
      }
      return allowed;
    }, false);
  }

  async _exists(filePath) {
    if (this._checkedPaths.has(filePath)) return this._checkedPaths.get(filePath);
    try {
      await fs.access(filePath);
      this._checkedPaths.set(filePath, true);
      return true;
    } catch {
      this._checkedPaths.set(filePath, false);
      return false;
    }
  }
}

module.exports = { LibraryManager };