const path = require('path');
const fs = require('fs/promises');

class NativesManager {
  constructor(root, versionData) {
    if (!root) throw new Error("El parámetro 'root' es obligatorio.");
    if (!versionData) throw new Error("El parámetro 'versionData' es obligatorio.");

    this.versionId = versionData.id || versionData.inheritsFrom || versionData.versionID;
    if (!this.versionId) throw new Error("No se pudo determinar el versionId");

    this.root = path.resolve(root);
    this.nativesDir = path.join(this.root, 'natives', this.versionId);
  }

  getNativesDir() {
    return this.nativesDir;
  }

  async exists() {
    try {
      const stats = await fs.stat(this.nativesDir);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  async ensureDir() {
    await fs.mkdir(this.nativesDir, { recursive: true });
  }

  async forceClean() {
    if (!(await this.exists())) return;
    const files = await fs.readdir(this.nativesDir);
    if (files.length === 0) return;

    await Promise.all(
      files.map(file => fs.rm(path.join(this.nativesDir, file), { recursive: true, force: true }))
    );
  }

  /**
   * Extrae la versión vanilla base de un versionId dado.
   * Ejemplos:
   *  - "1.12.2-forge1.7.10" => "1.12.2"
   *  - "1.16.5-OptiFine_HD_U_G7" => "1.16.5"
   *  - "1.7.10" => "1.7.10"
   * @param {string} versionId
   * @returns {string} version vanilla base
   */
  extractVanillaVersion(versionId) {
    // Elimina cualquier sufijo después de un guion "-"
    const base = versionId.split('-')[0];
    return base;
  }

  /**
   * Obtiene la carpeta de nativos efectiva para usar:
   * - Si existen nativos para esta versión, los devuelve.
   * - Si no, intenta obtener los nativos de la versión vanilla base.
   * @returns {Promise<string>} Ruta al directorio de nativos válido.
   * @throws Error si no existen nativos para ninguna de las versiones.
   */
  async getEffectiveNativesDir() {
    if (await this.exists()) {
      return this.nativesDir;
    }

    const vanillaVersionId = this.extractVanillaVersion(this.versionId);
    const vanillaNativesDir = path.join(this.root, 'natives', vanillaVersionId);

    try {
      const stats = await fs.stat(vanillaNativesDir);
      if (stats.isDirectory()) return vanillaNativesDir;
    } catch {
      // No existe la carpeta vanilla tampoco
    }

    throw new Error(`No se encontraron nativos para la versión ${this.versionId} ni para la vanilla base ${vanillaVersionId}`);
  }
}

module.exports = { NativesManager };
