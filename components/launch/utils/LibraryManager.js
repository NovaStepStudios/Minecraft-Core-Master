const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const unzipper = require("unzipper");

class LibraryManager {
  constructor(root, versionData, platform, options = {}) {
    this.root        = root;
    this.versionData = versionData;
    this.platform    = platform;
    this.cache       = new Map();
    this.extractedNatives = new Set();
    this.options = options; // { debug: boolean, forceExtract: boolean }
  }

  _debug(...args) {
    if (this.options.debug) console.log("[LibraryManager]", ...args);
  }

  _arch() {
    const arch = process.arch;
    return (arch === "x64" || arch === "arm64") ? "64" : arch;
  }

  async buildClasspath() {
    const libs = (this.versionData.libraries || []).filter(lib => this._ok(lib));
    const paths = [];

    for (const lib of libs) {
      const artifactPath = this._getLibraryPath(lib);
      if (artifactPath) paths.push(artifactPath);

      if (lib.natives?.[this.platform]) {
        await this._extractNative(lib);
      }
    }

    const vId = this.versionData.id || this.versionData.inheritsFrom;
    const clientJar = path.join(this.root, "versions", vId, `${vId}.jar`);
    paths.push(clientJar);

    const existing = [];
    for (const p of paths) {
      try {
        await fs.access(p);
        existing.push(p);
      } catch {
        this._debug(`Omitiendo librería faltante: ${p}`);
      }
    }

    this.cache.set(vId, existing);

    const separator = process.platform === "win32" ? ";" : ":";
    return existing.join(separator);
  }

  _getLibraryPath(lib) {
    if (lib.downloads?.artifact?.path) {
      return path.join(this.root, "libraries", lib.downloads.artifact.path);
    }

    const [group, artifact, version] = lib.name.split(":");
    const groupPath = group.replace(/\./g, path.sep);
    return path.join(this.root, "libraries", groupPath, artifact, version, `${artifact}-${version}.jar`);
  }

  async _extractNative(lib) {
    let classifier = lib.natives[this.platform];
    if (classifier.includes("${arch}")) {
      classifier = classifier.replace("${arch}", this._arch());
    }

    const nativePath = lib.downloads?.classifiers?.[classifier]?.path
      ? path.join(this.root, "libraries", lib.downloads.classifiers[classifier].path)
      : this._getNativeFallbackPath(lib.name, classifier);

    if (this.extractedNatives.has(nativePath)) {
      this._debug(`Nativo ya extraído: ${nativePath}`);
      return;
    }

    try {
      await fs.access(nativePath);
    } catch {
      this._debug(`No se encontró nativo para extraer: ${nativePath}`);
      return;
    }

    const extractDir = path.join(this.root, "natives", `${this.versionData.id}-${lib.name.replace(/[:.]/g, "_")}`);

    // Si no forzás, chequeá si ya hay archivos extraídos
    if (!this.options.forceExtract) {
      try {
        const files = await fs.readdir(extractDir);
        if (files.length > 0) {
          this._debug(`Nativos ya extraídos en: ${extractDir}`);
          this.extractedNatives.add(nativePath);
          return;
        }
      } catch { /* No existe, se creará */ }
    }

    await fs.mkdir(extractDir, { recursive: true });

    this._debug(`Extrayendo: ${nativePath} → ${extractDir}`);

    await new Promise((resolve, reject) => {
      fsSync.createReadStream(nativePath)
        .pipe(unzipper.Extract({ path: extractDir }))
        .on("close", resolve)
        .on("error", reject);
    });

    this._debug(`Extracción completada: ${extractDir}`);
    this.extractedNatives.add(nativePath);
  }

  _getNativeFallbackPath(name, classifier) {
    const [group, artifact, version] = name.split(":");
    const groupPath = group.replace(/\./g, path.sep);
    const fileName = `${artifact}-${version}-${classifier}.jar`;
    return path.join(this.root, "libraries", groupPath, artifact, version, fileName);
  }

  _ok(lib) {
    if (!lib.rules || lib.rules.length === 0) return true;

    let allow = false;
    for (const rule of lib.rules) {
      if (!rule.os || rule.os.name === this.platform) {
        if (rule.action === "allow") allow = true;
        if (rule.action === "disallow") allow = false;
      }
    }
    return allow;
  }
}

module.exports = { LibraryManager };
