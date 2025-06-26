const https = require("https");
const fs = require("fs");
const path = require("path");
const EventEmitter = require("events");
const os = require("os");

class JavaRuntimeFinder extends EventEmitter {
  constructor(rootPath, mcVersion) {
    super();
    this.rootPath = rootPath;
    this.mcVersion = mcVersion;
    this.platform = this._detectPlatform();
    this.javaRuntimeInfo = null;
    this.concurrentDownloads = 5;
  }

  _detectPlatform() {
    const platformMap = {
      win32: "windows-x64",
      linux: "linux",
      darwin: "mac-os",
    };
    return platformMap[os.platform()] || "windows-x64";
  }

  async fetchJson(url) {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        if (res.statusCode !== 200)
          return reject(new Error(`HTTP status ${res.statusCode} en ${url}`));
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Error parseando JSON de ${url}: ${e.message}`));
          }
        });
      }).on("error", (e) => reject(new Error(`Error en HTTPS GET ${url}: ${e.message}`)));
    });
  }

  async getJavaRuntime() {
    const manifestUrl = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    const manifest = await this.fetchJson(manifestUrl);

    const versionEntry = manifest.versions.find((v) => v.id === this.mcVersion);
    if (!versionEntry) throw new Error(`Versión ${this.mcVersion} no encontrada en manifest`);

    const versionData = await this.fetchJson(versionEntry.url);
    if (!versionData.javaVersion)
      throw new Error(`Versión ${this.mcVersion} no tiene javaVersion definido`);

    const { component, majorVersion } = versionData.javaVersion;

    const javaRuntimeManifestUrl =
      "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
    const javaRuntimeManifest = await this.fetchJson(javaRuntimeManifestUrl);

    const platformRuntimes = javaRuntimeManifest[this.platform];
    if (!platformRuntimes)
      throw new Error(`No hay datos de Java runtime para plataforma ${this.platform}`);

    const componentRuntimes = platformRuntimes[component];
    if (!componentRuntimes || componentRuntimes.length === 0)
      throw new Error(`No hay runtime para componente ${component} en plataforma ${this.platform}`);

    const matched =
      componentRuntimes.find((entry) =>
        entry.version.name.includes(majorVersion.toString())
      ) || componentRuntimes[0];

    const runtimeManifest = await this.fetchJson(matched.manifest.url);

    this.javaRuntimeInfo = {
      files: runtimeManifest.files,
      version: matched.version,
      component,
    };

    return this.javaRuntimeInfo;
  }

  _extractDownloadUrl(downloads) {
    if (!downloads) return null;
    if (typeof downloads === "string") return downloads;

    const candidates = ["raw", "lzma", "artifact", "url"];
    for (const key of candidates) {
      const entry = downloads[key];
      if (!entry) continue;
      if (typeof entry === "string") return entry;
      if (entry.url && typeof entry.url === "string") return entry.url;
    }
    return null;
  }

  _gatherFiles(files, basePath = "") {
    let result = [];
    for (const [key, value] of Object.entries(files)) {
      if (value.type === "file") {
        const url = this._extractDownloadUrl(value.downloads);
        if (url) {
          result.push({ path: path.join(basePath, key), url });
        } else {
          this.emit(
            "warn",
            `No hay URL para archivo ${path.join(basePath, key)}, se omite`
          );
        }
      } else if (value.type === "directory" && value.children) {
        result = result.concat(this._gatherFiles(value.children, path.join(basePath, key)));
      }
    }
    return result;
  }

  isInstalled() {
    if (!this.javaRuntimeInfo) return false;
    const baseDir = path.resolve(this.rootPath, "runtime", this.javaRuntimeInfo.version.name);
    try {
      const stats = fs.statSync(baseDir);
      if (!stats.isDirectory()) return false;
      const files = fs.readdirSync(baseDir);
      return files.length > 0;
    } catch {
      return false;
    }
  }

  async download() {
    if (!this.javaRuntimeInfo || !this.javaRuntimeInfo.files) {
      throw new Error("JavaRuntimeFinder: getJavaRuntime() debe ejecutarse antes de descargar.");
    }

    const outputDir = path.resolve(this.rootPath, "runtime", this.javaRuntimeInfo.version.name);

    if (this.isInstalled()) {
      this.emit("progress", "100");
      this.emit("done", "Java runtime ya instalado, se omite descarga");
      return;
    }

    fs.mkdirSync(outputDir, { recursive: true });

    const files = this._gatherFiles(this.javaRuntimeInfo.files);
    if (files.length === 0) {
      throw new Error("JavaRuntimeFinder: No se encontraron archivos para descargar");
    }

    let downloadedFiles = 0;
    const totalFiles = files.length;

    // Pool de descargas concurrentes
    let active = 0;
    let index = 0;

    return new Promise((resolve, reject) => {
      const next = () => {
        if (downloadedFiles === totalFiles) {
          this.emit("progress", "100");
          this.emit("done", "Java runtime instalado correctamente");
          resolve();
          return;
        }
        while (active < this.concurrentDownloads && index < totalFiles) {
          active++;
          const file = files[index++];
          const destPath = path.join(outputDir, file.path);
          fs.mkdirSync(path.dirname(destPath), { recursive: true });

          this._downloadFile(file.url, destPath)
            .then(() => {
              downloadedFiles++;
              active--;
              this.emit("progress", ((downloadedFiles / totalFiles) * 100).toFixed(1));
              next();
            })
            .catch((err) => {
              reject(err);
            });
        }
      };

      next();
    });
  }

  _downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const fileStream = fs.createWriteStream(dest);
      https
        .get(url, (res) => {
          if (res.statusCode !== 200) {
            return reject(new Error(`Error HTTP ${res.statusCode} descargando ${url}`));
          }
          res.pipe(fileStream);
          fileStream.on("finish", () => {
            fileStream.close(resolve);
          });
          fileStream.on("error", (err) => {
            fs.unlink(dest, () => reject(err));
          });
        })
        .on("error", (err) => {
          fs.unlink(dest, () => reject(err));
        });
    });
  }
}

module.exports = JavaRuntimeFinder;
