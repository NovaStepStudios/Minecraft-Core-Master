const path = require("path");
const fs = require("fs/promises");

class NativesManager {
  /**
   * @param {string} root Carpeta raíz del Minecraft
   * @param {Object} versionData Datos de la versión (con id o inheritsFrom)
   */
  constructor(root, versionData) {
    if (!root) throw new Error("El parámetro 'root' es obligatorio.");
    if (!versionData) throw new Error("El parámetro 'versionData' es obligatorio.");

    this.versionId = versionData.id || versionData.inheritsFrom || versionData.versionID;
    if (!this.versionId) throw new Error("No se pudo determinar el versionId");

    this.root = path.resolve(root);
    this.nativesPath = path.join(this.root, "natives", this.versionId);
  }

  /**
   * Asegura que el directorio de nativos exista.
   */
  async ensureDir() {
    await fs.mkdir(this.getNativesDir(), { recursive: true });
  }

  /**
   * Verifica si existe el directorio de nativos.
   */
  async exists() {
    try {
      const stats = await fs.stat(this.getNativesDir());
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Devuelve la ruta completa a la carpeta de nativos.
   */
  getNativesDir() {
    return this.nativesPath;
  }

  /**
   * Limpia el contenido del directorio de nativos (opcional).
   */
  async forceClean() {
    try {
      const files = await fs.readdir(this.getNativesDir());
      await Promise.all(files.map(file =>
        fs.rm(path.join(this.getNativesDir(), file), { recursive: true, force: true })
      ));
    } catch {
      // No hacer nada si el directorio no existe
    }
  }
}

module.exports = { NativesManager };
