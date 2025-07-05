const path = require("path");
const fs = require("fs/promises");

class VersionResolver {
  constructor(root, version) {
    if (!root) throw new Error("Parámetro 'root' requerido.");
    if (!version?.versionID) throw new Error("Parámetro 'version.versionID' requerido.");

    this.root = path.resolve(root);
    this.version = version;
    this.versionID = version.versionID;
    this.cache = new Map();
  }

  // Asegura que el JSON de versión (y sus padres, si tiene) existan en disco
  async ensurePresent() {
    await this.#ensureVersionPresent(this.versionID);
  }

  async #ensureVersionPresent(versionId) {
    const jsonPath = path.join(this.root, "versions", versionId, `${versionId}.json`);
    try {
      await fs.access(jsonPath);
    } catch {
      throw new Error(`Archivo de metadatos no encontrado para la versión: ${jsonPath}`);
      }

    // Leer para chequear herencia y validar recursivamente
    const raw = await fs.readFile(jsonPath, "utf-8");
    const data = JSON.parse(raw);
    if (data.inheritsFrom) {
      await this.#ensureVersionPresent(data.inheritsFrom);
    }
  }

  // Retorna el objeto de datos de la versión, cacheado
  async getData() {
    if (this.cache.has(this.versionID)) return this.cache.get(this.versionID);
    const data = await this.#resolveVersion(this.versionID);
    this.cache.set(this.versionID, data);
    return data;
  }

  // Resuelve versión con merge recursivo si tiene inheritsFrom
  async #resolveVersion(versionId) {
    const jsonPath = path.join(this.root, "versions", versionId, `${versionId}.json`);
    let raw;
    try {
      raw = await fs.readFile(jsonPath, "utf-8");
    } catch {
      throw new Error(`No se encontró el archivo de versión: ${versionId}`);
    }

    let versionData = JSON.parse(raw);

    if (versionData.inheritsFrom) {
      const baseData = await this.#resolveVersion(versionData.inheritsFrom);

      // Merge profundo: priorizamos hijo, pero mantenemos campos importantes del padre
      versionData = deepMerge(baseData, versionData);
    }

    return versionData;
  }

  // Retorna el path del JSON de la versión principal
  getJsonPath() {
    return path.join(this.root, "versions", this.versionID, `${this.versionID}.json`);
  }
  }

// Función simple para merge profundo de objetos,
// priorizando las propiedades del segundo objeto (hijo)
function deepMerge(target, source) {
  if (typeof target !== 'object' || target === null) return source;
  if (typeof source !== 'object' || source === null) return source;

  const result = Array.isArray(source) ? [...source] : { ...target };

  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key], source[key]);
    } else {
      result[key] = source[key];
    }
  }

  return result;
}

module.exports = { VersionResolver };
 