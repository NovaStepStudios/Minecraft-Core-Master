const path = require("path");
const fs = require("fs/promises");

class VersionResolver {
  /**
   * @param {string} root Ruta raíz del Minecraft
   * @param {Object} version Objeto con al menos { versionID }
   */
  constructor(root, version) {
    if (!root) throw new Error("Parámetro 'root' requerido.");
    if (!version?.versionID) throw new Error("Parámetro 'version.versionID' requerido.");

    this.root = path.resolve(root);
    this.version = version;
    this.versionID = version.versionID;
    this.jsonPath = path.join(this.root, "versions", this.versionID, `${this.versionID}.json`);
  }

  /**
   * Verifica que el archivo JSON de la versión esté presente.
   */
  async ensurePresent() {
    try {
      await fs.access(this.jsonPath);
    } catch {
      throw new Error(`Archivo de metadatos no encontrado para la versión: ${this.jsonPath}`);
    }
  }

  /**
   * Devuelve el contenido del archivo JSON de versión.
   */
  async getData() {
    try {
      const raw = await fs.readFile(this.jsonPath, "utf-8");
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`Error al leer/parsing JSON de la versión '${this.versionID}': ${err.message}`);
    }
  }

  /**
   * Devuelve la ruta al archivo JSON de la versión.
   */
  getJsonPath() {
    return this.jsonPath;
  }
}

module.exports = { VersionResolver };
