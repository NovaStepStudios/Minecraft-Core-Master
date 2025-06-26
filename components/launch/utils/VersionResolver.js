const path = require("path");
const fs = require("fs/promises");

class VersionResolver {
  constructor(root, version) {
    if (!root) throw new Error("Parámetro 'root' requerido.");
    if (!version?.versionID) throw new Error("Parámetro 'version.versionID' requerido.");

    this.root = path.resolve(root);
    this.version = version;
    this.versionID = version.versionID;
    this.jsonPath = path.join(this.root, "versions", this.versionID, `${this.versionID}.json`);
  }

  async ensurePresent() {
    try {
      await fs.access(this.jsonPath);
    } catch {
      throw new Error(`Archivo de metadatos no encontrado para la versión: ${this.jsonPath}`);
    }
  }

  async getData() {
    try {
      const raw = await fs.readFile(this.jsonPath, "utf-8");
      return JSON.parse(raw);
    } catch (err) {
      throw new Error(`Error al leer/parsing JSON de la versión '${this.versionID}': ${err.message}`);
    }
  }

  getJsonPath() {
    return this.jsonPath;
  }
}

module.exports = { VersionResolver };
