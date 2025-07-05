const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const https = require("https");

class AssetsManager {
  constructor(root, versionData, options = {}) {
    this.root = root;
    this.versionData = versionData;
    this.options = {
      debug: false,
      onProgress: null,
      ...options,
    };

    const versionId = versionData.id || versionData.inheritsFrom || "";
    const [major, minor, patch] = versionId.split('.').map(n => parseInt(n) || 0);

    const isLegacy = (major < 1) || (major === 1 && minor < 6) || (major === 1 && minor === 6 && patch < 1);

    this.assetsDir = isLegacy
      ? path.join(root, "assets", "virtual", "legacy")
      : path.join(root, "assets");

    this.indexId = versionData.assetIndex?.id || null;
    this.indexUrl = versionData.assetIndex?.url || null;
    this.indexFile = this.indexId
      ? path.join(this.assetsDir, "indexes", `${this.indexId}.json`)
      : null;

    this.indexData = null;
  }

  _debug(...args) {
    if (this.options.debug) console.log("[AssetsManager]", ...args);
  }

  async ensureIndexPresent() {
    // 🔄 Si falta assetIndex, intentar heredar desde la versión base
    if (!this.indexId || !this.indexUrl) {
      const inherits = this.versionData.inheritsFrom;
      if (!inherits) throw new Error("No hay assetIndex definido en versionData.");

      const baseJson = path.join(this.root, "versions", inherits, `${inherits}.json`);
      try {
        const raw = await fs.readFile(baseJson, "utf-8");
        const base = JSON.parse(raw);
        if (base.assetIndex?.id && base.assetIndex?.url) {
          this.indexId = base.assetIndex.id;
          this.indexUrl = base.assetIndex.url;
          this.indexFile = path.join(this.assetsDir, "indexes", `${this.indexId}.json`);
          this._debug(`🪄 AssetIndex heredado de ${inherits}: ${this.indexId}`);
        } else {
          throw new Error(`La versión base '${inherits}' tampoco tiene assetIndex.`);
        }
      } catch (err) {
        throw new Error(`No se pudo heredar assetIndex desde ${inherits}:\n${err.message}`);
      }
    }

    // ✅ Descargar o cargar index
    try {
      await fs.access(this.indexFile);
      this._debug(`✔️ Asset index ya presente: ${this.indexId}`);
    } catch {
      this._debug(`📥 Descargando asset index: ${this.indexId}`);
      await this._download(this.indexUrl, this.indexFile);
    }

    const raw = await fs.readFile(this.indexFile, "utf-8");
    this.indexData = JSON.parse(raw);

    if (!this.indexData.objects || typeof this.indexData.objects !== "object") {
      throw new Error(`Asset index corrupto o malformado: ${this.indexFile}`);
    }
  }

  async downloadAssets() {
    if (!this.indexData) {
      throw new Error("Debe llamar a ensureIndexPresent() antes de descargar assets.");
    }

    const objects = this.indexData.objects;
    const total = Object.keys(objects).length;
    let done = 0;

    for (const [key, { hash }] of Object.entries(objects)) {
      const subdir = hash.substring(0, 2);
      const remote = `https://resources.download.minecraft.net/${subdir}/${hash}`;
      const local = path.join(this.assetsDir, "objects", subdir, hash);

      try {
        await fs.access(local);
        this._debug(`✔️ Asset presente: ${key}`);
      } catch {
        this._debug(`📥 Descargando asset: ${key}`);
        await this._download(remote, local);
      }

      done++;
      if (this.options.onProgress) {
        this.options.onProgress({ done, total, current: key });
      }
    }

    this._debug(`🎉 Descarga de assets completada: ${done}/${total}`);
  }

  async isReady() {
    if (!this.indexFile) return true;
    try {
      await fs.access(this.indexFile);
      return true;
    } catch {
      return false;
    }
  }

  getAssetsDir() {
    return this.assetsDir;
  }

  getAssetIndexId() {
    return this.indexId;
  }

  getIndexData() {
    return this.indexData;
  }

  async _download(url, dest) {
    const dir = path.dirname(dest);
    await fs.mkdir(dir, { recursive: true });

    return new Promise((resolve, reject) => {
      const stream = fsSync.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} en descarga: ${url}`));
          return;
        }

        res.pipe(stream);
        stream.on("finish", () => stream.close(resolve));
        stream.on("error", reject);
      }).on("error", reject);
    });
  }
}

// ✅ Alias por compatibilidad con .ensurePresent()
AssetsManager.prototype.ensurePresent = AssetsManager.prototype.ensureIndexPresent;

module.exports = { AssetsManager };
