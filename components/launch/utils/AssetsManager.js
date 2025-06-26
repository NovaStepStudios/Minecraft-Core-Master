const path = require("path");
const fs = require("fs/promises");

class AssetsManager {
  constructor(root, versionData) {
    this.root = root;
    this.versionData = versionData;

    const versionId = versionData.id || versionData.inheritsFrom || "";
    const [major, minor, patch] = versionId.split('.').map(n => parseInt(n) || 0);

    const isLegacy = (major < 1) || (major === 1 && minor < 6) || (major === 1 && minor === 6 && patch < 1);

    this.assetsDir = isLegacy
      ? path.join(root, "assets", "virtual", "legacy")
      : path.join(root, "assets");

    this.indexId = versionData.assetIndex?.id || null;
    this.indexFile = this.indexId ? path.join(this.assetsDir, "indexes", `${this.indexId}.json`) : null;
    this.indexData = null;
  }

  async ensurePresent() {
    if (!this.indexId) {
      this.indexData = null;
      return;
    }

    try {
      const raw = await fs.readFile(this.indexFile, "utf-8");
      this.indexData = JSON.parse(raw);

      if (!this.indexData.objects || typeof this.indexData.objects !== "object") {
        throw new Error("Asset index inválido (falta 'objects')");
      }
    } catch (err) {
      throw new Error(`Asset index inválido o ausente: ${this.indexFile}\n${err.message}`);
    }
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

  getAssetsDir() { return this.assetsDir; }
  getAssetIndexId() { return this.indexId; }
  getIndexData() { return this.indexData; }
}

module.exports = { AssetsManager };
