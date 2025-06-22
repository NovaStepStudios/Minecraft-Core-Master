const path = require("path");
const fs   = require("fs/promises");

class AssetsManager {
  constructor(root, versionData) {
    this.root        = root;
    this.versionData = versionData;
    this.assetsDir   = path.join(root, "assets");
    this.indexId     = versionData.assetIndex?.id || versionData.id;
    this.indexFile   = path.join(this.assetsDir, "indexes", `${this.indexId}.json`);
    this.indexData   = null; // ← guardamos el JSON parseado
  }

  /** Verifica que el índice exista y sea válido (no corrupto). */
  async ensurePresent() {
    try {
      const raw = await fs.readFile(this.indexFile, "utf-8");
      this.indexData = JSON.parse(raw);

      // Validación rápida: que tenga "objects"
      if (!this.indexData.objects || typeof this.indexData.objects !== "object") {
        throw new Error("Asset index inválido (falta 'objects')");
      }

    } catch (err) {
      throw new Error(`Asset index inválido o ausente: ${this.indexFile}\n${err.message}`);
    }
  }

  /** Devuelve true si el índice existe sin lanzar errores. */
  async isReady() {
    try {
      await fs.access(this.indexFile);
      return true;
    } catch {
      return false;
    }
  }

  getAssetsDir()     { return this.assetsDir; }
  getAssetIndexId()  { return this.indexId;  }
  getIndexData()     { return this.indexData; }
}

module.exports = { AssetsManager };
