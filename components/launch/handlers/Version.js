"use strict";
const path = require('path');
const fs = require('fs');

/**
 * Mezcla recursivamente las propiedades de source en target.
 * Si la propiedad es objeto, hace merge profundo; si no, la sobreescribe.
 */
const mergeDeep = (target, source) => {
  for (const key of Object.keys(source)) {
    if (
      typeof source[key] === 'object' &&
      !Array.isArray(source[key]) &&
      source[key] !== null
    ) {
      if (!target[key]) target[key] = {};
      mergeDeep(target[key], source[key]);
    } else {
      target[key] = source[key];
    }
  }
};

module.exports = {
  /**
   * Carga un JSON de versión con soporte para `inheritsFrom`,
   * resolviendo todo en un solo objeto consolidado.
   */
  async load(root, versionID) {
    const resolvedVersions = new Set(); // para evitar bucles infinitos

    /**
     * Función recursiva que resuelve herencia.
     */
    const resolveJson = async (id) => {
      if (resolvedVersions.has(id)) {
        throw new Error(`Bucle de herencia detectado en la versión '${id}'`);
      }

      resolvedVersions.add(id);

      const dir = path.join(root, 'versions', id);
      const jsonPath = path.join(dir, `${id}.json`);

      if (!fs.existsSync(jsonPath)) {
        throw new Error(`Archivo JSON no encontrado para versión '${id}': ${jsonPath}`);
      }

      const raw = fs.readFileSync(jsonPath, 'utf-8');
      const data = JSON.parse(raw);

      if (data.inheritsFrom) {
        const baseData = await resolveJson(data.inheritsFrom);
        mergeDeep(baseData, data);
        return baseData;
      }

      return data;
    };

    const finalData = await resolveJson(versionID);

    // Validar JAR final (de la versión base efectiva, la que NO tiene inheritsFrom)
    const jarID = (() => {
      let currentID = versionID;
      while (true) {
        const currentJsonPath = path.join(root, 'versions', currentID, `${currentID}.json`);
        const json = JSON.parse(fs.readFileSync(currentJsonPath, 'utf-8'));
        if (!json.inheritsFrom) return currentID;
        currentID = json.inheritsFrom;
      }
    })();

    const finalJarPath = path.join(root, 'versions', jarID, `${jarID}.jar`);
    if (!fs.existsSync(finalJarPath)) {
      throw new Error(`JAR base no encontrado: ${finalJarPath}`);
    }

    return finalData;
  }
};
