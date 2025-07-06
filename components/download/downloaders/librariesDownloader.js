const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const https = require("https");
const os = require("os");
const crypto = require("crypto");
const EventEmitter = require("events");

class LibrariesDownloader extends EventEmitter {
  constructor(root, version, { concurrency = 5, timeout = 15000, maxRetries = 3 } = {}) {
    super();
    this.root = root;
    this.version = version;
    this.libDir = path.join(root, "libraries");
    this.concurrent = concurrency;
    this.timeout = timeout;
    this.maxRetries = maxRetries;

    this.platform = {
      win32: "windows",
      darwin: "osx",
      linux: "linux",
    }[os.platform()] || null;

    this.arch = {
      x64: "64",
      arm64: "arm64",
      ia32: "32",
      arm: "arm",
    }[os.arch()] || "64";

    this.activeCount = 0;
    this.queue = [];
  }

  static async _sha1(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha1");
      const stream = fs.createReadStream(filePath);
      stream.on("error", reject);
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  async _download(url, dest, expectedSha1 = null, attempt = 1) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });

    if (fs.existsSync(dest) && expectedSha1) {
      try {
        const actualSha = await LibrariesDownloader._sha1(dest);
        if (actualSha === expectedSha1) {
          this.emit("debug", `[LibrariesDownloader] ✔ Archivo válido encontrado: ${dest}`);
          return;
        } else {
          this.emit("debug", `[LibrariesDownloader] ⚠ SHA1 no coincide para ${dest}, re-descargando...`);
          await fsp.unlink(dest);
        }
      } catch (e) {
        this.emit("debug", `[LibrariesDownloader] ⚠ Error verificando SHA1 para ${dest}: ${e.message}`);
      }
    }

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      const req = https.get(url, { timeout: this.timeout }, (res) => {
        if (res.statusCode !== 200) {
          file.close();
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          if (attempt < this.maxRetries) {
            this.emit("debug", `[LibrariesDownloader] Retry ${attempt}/${this.maxRetries} para ${url} por status ${res.statusCode}`);
            return resolve(this._download(url, dest, expectedSha1, attempt + 1));
          }
          return reject(new Error(`HTTP ${res.statusCode} → ${url}`));
        }
        res.pipe(file);
      });

      req.on("timeout", () => {
        req.destroy(new Error("Timeout exceeded"));
      });

      req.on("error", async (err) => {
        file.close();
        if (fs.existsSync(dest)) await fsp.unlink(dest);
        if (attempt < this.maxRetries) {
          this.emit("debug", `[LibrariesDownloader] Retry ${attempt}/${this.maxRetries} para ${url} por error: ${err.message}`);
          return resolve(this._download(url, dest, expectedSha1, attempt + 1));
        }
        reject(err);
      });

      file.on("finish", async () => {
        file.close();
        if (expectedSha1) {
          try {
            const actualSha = await LibrariesDownloader._sha1(dest);
            if (actualSha !== expectedSha1) {
              await fsp.unlink(dest);
              if (attempt < this.maxRetries) {
                this.emit("debug", `[LibrariesDownloader] Retry ${attempt}/${this.maxRetries} para ${url} por SHA1 mismatch`);
                return resolve(this._download(url, dest, expectedSha1, attempt + 1));
              }
              return reject(new Error(`SHA1 mismatch: ${url}`));
            }
          } catch (e) {
            await fsp.unlink(dest);
            return reject(e);
          }
        }
        this.emit("debug", `[LibrariesDownloader] ✔ Descargado: ${dest}`);
        resolve();
      });

      file.on("error", async (err) => {
        file.close();
        if (fs.existsSync(dest)) await fsp.unlink(dest);
        reject(err);
      });
    });
  }

  async _json(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: this.timeout }, (res) => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on("error", reject);
      req.setTimeout(this.timeout, () => req.destroy(new Error("Timeout exceeded")));
    });
  }

  async _loadVersionJSON() {
    const manifest = await this._json("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
    const versionInfo = manifest.versions.find((v) => v.id === this.version);
    if (!versionInfo) throw new Error(`Versión '${this.version}' no encontrada`);
    return this._json(versionInfo.url);
  }

  _allowed(lib) {
    if (!lib.rules) return true;
    let allow = false;
    for (const rule of lib.rules) {
      if (rule.os?.name && rule.os.name !== this.platform) continue;
      allow = rule.action === "allow";
    }
    return allow;
  }

  _asNative(lib) {
    if (lib.natives?.[this.platform]) {
      const key = lib.natives[this.platform].replace("${arch}", this.arch);
      return { classifier: key, legacy: false };
    }
    const match = lib.name.match(/:natives-([a-zA-Z0-9_\-]+)$/);
    if (match) return { classifier: null, legacy: true };
    return null;
  }

  _destPath(lib, classifier = null) {
    if (classifier && lib.downloads.classifiers && lib.downloads.classifiers[classifier]) {
      return path.join(this.libDir, lib.downloads.classifiers[classifier].path);
    }
    if (lib.downloads.artifact) {
      return path.join(this.libDir, lib.downloads.artifact.path);
    }
    return null;
  }

  async _processLib(lib) {
    const nfo = this._asNative(lib);
    const isNative = !!nfo;

    let destJar, url, sha;
    if (isNative && !nfo.legacy) {
      const cls = nfo.classifier;
      destJar = this._destPath(lib, cls);
      url = lib.downloads.classifiers[cls]?.url;
      sha = lib.downloads.classifiers[cls]?.sha1;
    } else {
      destJar = this._destPath(lib);
      url = lib.downloads.artifact?.url;
      sha = lib.downloads.artifact?.sha1;
    }

    if (!destJar || !url) {
      this.emit("debug", `[LibrariesDownloader] ⚠ Ruta o URL faltante para ${lib.name}, se omite.`);
      return;
    }

    await this._download(url, destJar, sha);
  }

  async _worker() {
    while (this.queue.length > 0) {
      if (this.activeCount >= this.concurrent) {
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      const lib = this.queue.shift();
      this.activeCount++;
      try {
        await this._processLib(lib);
      } catch (e) {
        this.emit("debug", `[LibrariesDownloader] ⚠ Error descargando ${lib.name}: ${e.message}`);
      } finally {
        this.activeCount--;
        this.emit(
          "progress",
          (((this.totalLibs - this.queue.length - this.activeCount) / this.totalLibs) * 100).toFixed(1)
        );
      }
    }
  }

  async start() {
    try {
      await fsp.mkdir(this.libDir, { recursive: true });

      await this._downloadLaunchWrapper();

      const versionJson = await this._loadVersionJSON();

      if (versionJson.libraries) {
        for (const lib of versionJson.libraries) {
          if (lib.name === "net.minecraft:launchwrapper:1.12" && lib.downloads.artifact) {
            const origPath = lib.downloads.artifact.path;
            // Asegurarse que sea string antes de replace
            if (typeof origPath === "string") {
              const fixedPath = origPath.replace(/launchwrapper\/launchwrapper\//, "launchwrapper/");
              if (origPath !== fixedPath) {
                this.emit("debug", `[LibrariesDownloader] Corrigiendo ruta launchwrapper: ${origPath} -> ${fixedPath}`);
                lib.downloads.artifact.path = fixedPath;
              }
            }
          }
        }
      }

      const libs = (versionJson.libraries || []).filter((lib) => this._allowed(lib));
      this.totalLibs = libs.length;
      this.queue = libs;

      const workers = [];
      for (let i = 0; i < this.concurrent; i++) {
        workers.push(this._worker());
      }

      await Promise.all(workers);

      this.emit("done", "✅ Todas las librerías descargadas correctamente.");
    } catch (e) {
      this.emit("error", e.message);
    }
  }

  async _downloadLaunchWrapper() {
    try {
      const url = "https://libraries.minecraft.net/net/minecraft/launchwrapper/1.12/launchwrapper-1.12.jar";
      const dest = path.join(this.root, "libraries", "net", "minecraft", "launchwrapper", "1.12", "launchwrapper-1.12.jar");
      this.emit("debug", `[LibrariesDownloader] Descargando launchwrapper manual: ${url}`);
      await this._download(url, dest, null);
      this.emit("debug", `[LibrariesDownloader] ✔ launchwrapper descargado en: ${dest}`);
    } catch (e) {
      this.emit("error", `[LibrariesDownloader] Error descargando launchwrapper: ${e.message}`);
    }
  }
}

module.exports = (root, version, opts) => new LibrariesDownloader(root, version, opts);
