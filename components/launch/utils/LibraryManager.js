const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const unzipper = require("unzipper");
const https = require("https");

class LibraryManager {
  constructor(root, versionData, platform, options = {}) {
    this.root = root;
    this.versionData = versionData;
    this.platform = platform;
    this.options = {
      debug: false,
      forceExtract: false,
      skipSha1Errors: true,
      abortOnDownloadError: false,
      maxDownloadRetries: 3,
      ...options,
    };

    this._checkedPaths = new Map();
    this._resolvedLibs = new Map();
    this.extractedNatives = new Set();
  }

  _debug(...args) {
    if (this.options.debug) console.log("[LibraryManager]", ...args);
  }

  /** Construye el classpath completo validando y descargando librerías */
  async buildClasspath() {
    const sep = process.platform === "win32" ? ";" : ":";
    const versionId = this.versionData.inheritsFrom || this.versionData.id;
    let libs = [...(this.versionData.libraries || [])];

    // Si hay herencia de versión (Forge, OptiFine, etc.), combinar librerías base y actuales
    if (this.versionData.inheritsFrom) {
      const baseData = await this._loadVersionJson(this.versionData.inheritsFrom);
      if (baseData?.libraries) {
        libs = this._mergeLibraries(baseData.libraries, libs);
        this._debug(`📚 Librerías combinadas de ${this.versionData.inheritsFrom} + ${this.versionData.id}`);
      }
    }

    // Filtrar librerías según reglas (OS, features, etc.)
    libs = libs.filter(lib => this._checkRules(lib));

    // Eliminar duplicados por group:artifact, quedándose con la versión más reciente
    const libMap = new Map();
    for (const lib of libs) {
      const parts = lib.name.split(":");
      if (parts.length < 3) continue;
      const key = `${parts[0]}:${parts[1]}`; // group:artifact
      const currentVersion = parts[2];

      const existing = libMap.get(key);
      if (!existing || this._compareVersions(currentVersion, existing.name.split(":")[2]) > 0) {
        libMap.set(key, lib);
      }
    }
    libs = Array.from(libMap.values());

    // Ordenar: Forge primero, luego Guava, luego el resto
    libs.sort((a, b) => {
      const an = a.name.toLowerCase();
      const bn = b.name.toLowerCase();

      if (an.includes("net.minecraftforge") && !bn.includes("net.minecraftforge")) return -1;
      if (!an.includes("net.minecraftforge") && bn.includes("net.minecraftforge")) return 1;

      if (an.includes("com.google.guava:guava") && !bn.includes("com.google.guava:guava")) return -1;
      if (!an.includes("com.google.guava:guava") && bn.includes("com.google.guava:guava")) return 1;

      return 0;
    });

    // Validar y/o descargar librerías faltantes
    for (const lib of libs) {
      let jarPath = await this._resolveLibraryPath(lib);

      if (!jarPath) {
        this._debug(`📦 Descargando librería faltante: ${lib.name}`);
        const downloaded = await this._downloadLibrary(lib);
        jarPath = downloaded ? await this._resolveLibraryPath(lib) : null;

        if (!jarPath) {
          const msg = `❌ Librería no disponible: ${lib.name}`;
          this._debug(msg);
          if (this.options.abortOnDownloadError) throw new Error(msg);
          continue;
        }
      }

      // Validación específica para Forge (comprobar existencia de FMLTweaker)
      if (lib.name.startsWith("net.minecraftforge:forge")) {
        const hasTweaker = await this._jarHasClass(jarPath, "cpw/mods/fml/common/launcher/FMLTweaker.class");
        if (!hasTweaker) {
          this._debug(`⚠️ Forge inválido (sin FMLTweaker): ${jarPath}`);
          // Aquí podrías lanzar un error si quieres ser estricto
        } else {
          this._debug(`✅ Forge verificado (contiene FMLTweaker): ${jarPath}`);
        }
      }
    }

    // Construir classpath único
    const classpath = new Set();
    for (const lib of libs) {
      const jar = await this._resolveLibraryPath(lib);
      if (jar) classpath.add(jar);
    }

    // Incluir client.jar de la versión
    const clientJar = path.join(this.root, "versions", versionId, `${versionId}.jar`);
    if (await this._exists(clientJar)) {
      classpath.add(clientJar);
    } else {
      this._debug(`⚠️ client.jar no encontrado: ${clientJar}`);
    }

    return [...classpath].join(sep);
  }

  /** Compara versiones "x.y.z" */
  _compareVersions(a, b) {
    if (!a && !b) return 0;
    if (!a) return -1;
    if (!b) return 1;

    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const na = pa[i] || 0;
      const nb = pb[i] || 0;
      if (na > nb) return 1;
      if (na < nb) return -1;
    }
    return 0;
  }

  /** Extrae los archivos nativos a destino */
  async extractNatives(destination) {
    if (this.extractedNatives.has(destination) && !this.options.forceExtract) {
      this._debug(`🧩 Nativos ya extraídos en: ${destination}, omitiendo.`);
      return;
    }

    const libs = await this._getAllNativeLibs();
    await fs.mkdir(destination, { recursive: true });

    for (const lib of libs) {
      const jarPath = await this._resolveLibraryPath(lib);
      if (!jarPath) {
        this._debug(`⚠️ No se encontró archivo nativo para extraer: ${lib.name}`);
        continue;
      }

      try {
        await this._extractNativeFiles(jarPath, destination);
        this._debug(`🧩 Extraídos nativos de ${lib.name} en ${destination}`);
      } catch (err) {
        this._debug(`❌ Error extrayendo nativos de ${lib.name}: ${err.message}`);
        if (this.options.abortOnDownloadError) throw err;
      }
    }

    this.extractedNatives.add(destination);
  }

  /** Extrae solo archivos nativos válidos desde el JAR */
  async _extractNativeFiles(jarPath, destination) {
    return new Promise((resolve, reject) => {
      const stream = fsSync.createReadStream(jarPath).pipe(unzipper.Parse({ forceStream: true }));

      stream.on("error", reject);

      (async () => {
        for await (const entry of stream) {
          if (
            entry.type === "File" &&
            !entry.path.includes("META-INF") &&
            entry.path.match(/\.(dll|so|dylib|jnilib)$/i)
          ) {
            const destPath = path.join(destination, path.basename(entry.path));
            await fs.mkdir(path.dirname(destPath), { recursive: true });
            await new Promise((res, rej) => {
              entry.pipe(fsSync.createWriteStream(destPath))
                .on("close", res)
                .on("error", rej);
            });
          } else {
            entry.autodrain();
          }
        }
        resolve();
      })().catch(reject);
    });
  }

  /** Obtiene todas las librerías nativas aplicables a la plataforma */
  async _getAllNativeLibs() {
    const libs = this.versionData.libraries || [];
    const result = [];

    for (const lib of libs) {
      if (!this._checkRules(lib)) continue;
      if (!lib.natives) continue;

      const classifier = lib.natives[this.platform];
      if (!classifier) continue;

      // Reemplazar artifact si tiene classifiers
      if (lib.downloads?.classifiers?.[classifier]) {
        lib.downloads = lib.downloads || {};
        lib.downloads.artifact = lib.downloads.classifiers[classifier];
      }

      if (lib.downloads?.artifact) result.push(lib);
    }

    return result;
  }

  /** Obtiene el path local a la librería, descargándola si falta */
  async _resolveLibraryPath(lib) {
    if (this._resolvedLibs.has(lib.name)) return this._resolvedLibs.get(lib.name);

    let artifact = lib.downloads?.artifact;
    if (!artifact || !artifact.path) {
      artifact = this._reconstructArtifact(lib.name);
      if (!artifact) return null;
    }

    const fullPath = path.join(this.root, "libraries", artifact.path);
    if (await this._exists(fullPath)) {
      this._resolvedLibs.set(lib.name, fullPath);
      return fullPath;
    }

    this._debug(`⚠️ Archivo local no encontrado para librería: ${lib.name} en ${fullPath}`);

    // Intentar descargar librería faltante
    const downloaded = await this._downloadLibrary(lib);
    if (downloaded && (await this._exists(fullPath))) {
      this._resolvedLibs.set(lib.name, fullPath);
      return fullPath;
    }

    return null;
  }

  /** Descarga la librería, con retries */
  async _downloadLibrary(lib) {
    const artifact = lib.downloads?.artifact || this._reconstructArtifact(lib.name);
    if (!artifact) return false;

    const url = artifact.url;
    const dest = path.join(this.root, "libraries", artifact.path);

    await fs.mkdir(path.dirname(dest), { recursive: true });

    const downloadFile = () =>
      new Promise((resolve, reject) => {
        https.get(url, (res) => {
          if (res.statusCode !== 200) return reject(new Error(`Error HTTP ${res.statusCode}`));
          const fileStream = fsSync.createWriteStream(dest);
          res.pipe(fileStream);
          fileStream.on("finish", () => fileStream.close(resolve));
          fileStream.on("error", reject);
        }).on("error", reject);
      });

    for (let attempt = 1; attempt <= this.options.maxDownloadRetries; attempt++) {
      try {
        this._debug(`⬇️ Descargando librería ${lib.name} intento ${attempt} desde ${url}`);
        await downloadFile();
        this._debug(`✅ Descargado ${lib.name}`);
        return true;
      } catch (err) {
        this._debug(`❌ Error descargando ${lib.name} (intento ${attempt}): ${err.message}`);
        if (attempt === this.options.maxDownloadRetries && this.options.abortOnDownloadError) throw err;
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    return false;
  }

  /** Reconstruye la URL y path del artifact a partir del nombre de la librería */
  _reconstructArtifact(libName) {
    const parts = libName.split(":");
    if (parts.length < 3) return null;
    const [group, artifactId, version] = parts;
    const basePath = `${group.replace(/\./g, "/")}/${artifactId}/${version}`;
    const jarName = `${artifactId}-${version}.jar`;
    return {
      url: `https://libraries.minecraft.net/${basePath}/${jarName}`,
      path: `${basePath}/${jarName}`,
    };
  }

  /** Filtra librerías por reglas OS/features */
  _checkRules(lib) {
    if (!lib.rules) return true;

    // La última regla que aplica para la plataforma decide si se permite o no
    let allowed = false;
    for (const rule of lib.rules) {
      if (!rule.os) {
        allowed = rule.action === "allow";
        continue;
      }
      if (rule.os.name === this.platform) {
        allowed = rule.action === "allow";
      }
    }
    return allowed;
  }

  /** Checkea existencia en disco con cache */
  async _exists(file) {
    if (this._checkedPaths.has(file)) return this._checkedPaths.get(file);
    try {
      await fs.access(file);
      this._checkedPaths.set(file, true);
      return true;
    } catch {
      this._checkedPaths.set(file, false);
      return false;
    }
  }

  /** Carga JSON de versión */
  async _loadVersionJson(versionId) {
    const file = path.join(this.root, "versions", versionId, `${versionId}.json`);
    try {
      const content = await fs.readFile(file, "utf-8");
      return JSON.parse(content);
    } catch (err) {
      this._debug(`❌ Error cargando versión ${versionId}: ${err.message}`);
      return null;
    }
  }

  /** Combina arrays de librerías evitando duplicados por name */
  _mergeLibraries(base, current) {
    const names = new Set(base.map(l => l.name));
    return [...base, ...current.filter(l => !names.has(l.name))];
  }

  /** Revisa si un JAR contiene una clase específica */
  async _jarHasClass(jarPath, className) {
    try {
      const zip = fsSync.createReadStream(jarPath).pipe(unzipper.Parse({ forceStream: true }));
      for await (const entry of zip) {
        if (entry.path === className) return true;
        entry.autodrain();
      }
      return false;
    } catch (err) {
      this._debug(`❌ Error inspeccionando ${jarPath}: ${err.message}`);
      return false;
    }
  }
}

module.exports = { LibraryManager };
