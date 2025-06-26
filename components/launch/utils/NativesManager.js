
const path = require("path");
const fs = require("fs/promises");

class NativesManager {
  constructor(root, versionData) {
    if (!root) throw new Error("El parámetro 'root' es obligatorio.");
    if (!versionData) throw new Error("El parámetro 'versionData' es obligatorio.");

    this.versionId = versionData.id || versionData.inheritsFrom || versionData.versionID;
    if (!this.versionId) throw new Error("No se pudo determinar el versionId");

    this.root = path.resolve(root);
    this.nativesPath = path.join(this.root, "natives", this.versionId);
  }

  async ensureDir() {
    await fs.mkdir(this.getNativesDir(), { recursive: true });
  }

  async exists() {
    try {
      const stats = await fs.stat(this.getNativesDir());
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  getNativesDir() {
    return this.nativesPath;
  }

  async forceClean() {
    const dir = this.getNativesDir();
    if (!(await this.exists())) return;
    const files = await fs.readdir(dir);
    if (files.length === 0) return;

    await Promise.all(
      files.map(file => fs.rm(path.join(dir, file), { recursive: true, force: true }))
    );
  }
}

module.exports = { NativesManager };
