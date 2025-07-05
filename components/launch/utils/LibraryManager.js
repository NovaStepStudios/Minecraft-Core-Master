const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const unzipper = require("unzipper");

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
    this.extractedNatives = new Set(); // Importante que exista para evitar errores
  }

  _debug(...args) {
    if (this.options.debug) console.log("[LibraryManager]", ...args);
  }

  async buildClasspath() {
    const sep = process.platform === "win32" ? ";" : ":";
    let libs = this.versionData.libraries || [];
    const baseId = this.versionData.inheritsFrom;
    const currentId = this.versionData.id;
    const versionId = baseId || currentId;

    if (baseId) {
      const baseData = await this._loadVersionJson(baseId);
      if (baseData?.libraries) {
        libs = this._mergeLibraries(baseData.libraries, libs);
        this._debug(`📚 Librerías combinadas de ${baseId} + ${currentId}`);
      }
    }

    // FILTRAR DUPLICADOS EXACTOS (mismo group:artifact:version)
    const uniqueLibMap = new Map();
    for (const lib of libs) {
      if (!this._checkRules(lib)) continue;
      if (!uniqueLibMap.has(lib.name)) {
        uniqueLibMap.set(lib.name, lib);
      } else {
        this._debug(`🔹 Eliminado duplicado: ${lib.name}`);
      }
    }
    libs = Array.from(uniqueLibMap.values());

    // ORDENAR: Forge primero, Guava segundo, resto luego
    libs.sort((a, b) => {
      const aName = a.name.toLowerCase();
      const bName = b.name.toLowerCase();
      if (aName.includes("net.minecraftforge")) return -1;
      if (bName.includes("net.minecraftforge")) return 1;
      if (aName.includes("com.google.guava:guava")) return -1;
      if (bName.includes("com.google.guava:guava")) return 1;
      return 0;
    });

    // Validar localmente sin descargar
    for (const lib of libs) {
      const jar = await this._resolveLibraryPath(lib);
      if (!jar) {
        this._debug(`⚠️ Archivo faltante local para ${lib.name}`);
        continue;
      }

      // Validar Forge específicamente
      if (lib.name?.startsWith("net.minecraftforge:forge")) {
        const hasTweaker = await this._jarHasClass(jar, "cpw/mods/fml/common/launcher/FMLTweaker.class");
        if (!hasTweaker) {
          this._debug(`❌ Forge inválido: falta FMLTweaker.class en ${jar}`);
        } else {
          this._debug(`✅ Forge válido con FMLTweaker.class en ${jar}`);
        }
      }
    }

    // Añadir client.jar al classpath
    const jarPath = path.join(this.root, "versions", versionId, `${versionId}.jar`);
    const classpathSet = new Set();

    for (const lib of libs) {
      const jar = await this._resolveLibraryPath(lib);
      if (jar) classpathSet.add(jar);
    }
    if (await this._exists(jarPath)) {
      classpathSet.add(jarPath);
    } else {
      this._debug(`⚠️ No se encontró el client.jar: ${jarPath}`);
    }

    return [...classpathSet].join(sep);
  }

  _compareVersions(a, b) {
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
  async extractNatives(destination) {
    const libs = await this._getAllNativeLibs();
    await fs.mkdir(destination, { recursive: true });

    for (const lib of libs) {
      const jarPath = await this._resolveLibraryPath(lib);
      if (!jarPath) continue;

      const zip = fsSync.createReadStream(jarPath).pipe(unzipper.Parse({ forceStream: true }));
      for await (const entry of zip) {
        if (entry.type === "File" && !entry.path.includes("META-INF") && entry.path.match(/\.(dll|so|dylib)$/)) {
          const destPath = path.join(destination, path.basename(entry.path));
          await fs.mkdir(path.dirname(destPath), { recursive: true });
          await new Promise((res, rej) => {
            entry.pipe(fsSync.createWriteStream(destPath)).on("close", res).on("error", rej);
          });
        } else {
          entry.autodrain();
        }
      }
    }

    this.extractedNatives.add(destination);
    this._debug(`🧩 Nativos extraídos en: ${destination}`);
  }

  async _getAllNativeLibs() {
    const libs = this.versionData.libraries || [];
    const result = [];

    for (const lib of libs) {
      if (!this._checkRules(lib)) continue;
      if (!lib.natives) continue;

      const classifier = lib.natives[this.platform];
      if (!classifier) continue;

      // Cambia el artifact si tiene classifiers
      lib.downloads = lib.downloads || {};
      lib.downloads.artifact = lib.downloads.classifiers?.[classifier];
      if (lib.downloads.artifact) result.push(lib);
    }

    return result;
  }

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

    return null;
  }

  _reconstructArtifact(libName) {
    const [group, artifactId, version] = libName.split(":");
    if (!group || !artifactId || !version) return null;

    const pathUrl = `${group.replace(/\./g, "/")}/${artifactId}/${version}/${artifactId}-${version}.jar`;
    return {
      url: `https://libraries.minecraft.net/${pathUrl}`, // solo referencia, no descarga
      path: pathUrl,
    };
  }

  _checkRules(lib) {
    if (!lib.rules) return true;
    return lib.rules.some(rule => {
      const matchOS = !rule.os || rule.os.name === this.platform;
      return matchOS && rule.action === "allow";
    });
  }

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

  async _loadVersionJson(versionId) {
    const file = path.join(this.root, "versions", versionId, `${versionId}.json`);
    try {
      const content = await fs.readFile(file, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  _mergeLibraries(base, current) {
    const names = new Set(base.map(l => l.name));
    return [...base, ...current.filter(l => !names.has(l.name))];
  }

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
