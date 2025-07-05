const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const https = require("https");
const os = require("os");
const crypto = require("crypto");
const EventEmitter = require("events");

class LibrariesDownloader extends EventEmitter {
  constructor(root, version, { concurrency = 5 } = {}) {
    super();
    this.root = root;
    this.version = version;
    this.libDir = path.join(root, "libraries");
    this.concurrent = concurrency;

    this.platform = {
      win32: "windows",
      darwin: "osx",
      linux: "linux"
    }[os.platform()] || null;

    this.arch = {
      x64: "64",
      arm64: "arm64",
      ia32: "32"
    }[os.arch()] || "64";
  }

  static async _sha1(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha1");
      const stream = fs.createReadStream(filePath);
      stream.on("error", reject);
      stream.on("data", chunk => hash.update(chunk));
      stream.on("end", () => resolve(hash.digest("hex")));
    });
  }

  async _download(url, dest, expectedSha1, attempt = 1) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });

    if (fs.existsSync(dest) && expectedSha1) {
      const actualSha = await LibrariesDownloader._sha1(dest);
      if (actualSha === expectedSha1) {
        this.emit("debug", `[LibrariesDownloader] ✔ Archivo válido encontrado: ${dest}`);
        return; // No descargar si ya está bien
      } else {
        this.emit("debug", `[LibrariesDownloader] ⚠ SHA1 no coincide para ${dest}, re-descargando...`);
        await fsp.unlink(dest);
      }
    }

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          if (attempt < 3) return resolve(this._download(url, dest, expectedSha1, attempt + 1));
          return reject(new Error(`HTTP ${res.statusCode} → ${url}`));
        }

        res.pipe(file);

        file.on("finish", async () => {
          file.close();
          if (expectedSha1) {
            const actualSha = await LibrariesDownloader._sha1(dest);
            if (actualSha !== expectedSha1) {
              await fsp.unlink(dest);
              if (attempt < 3) return resolve(this._download(url, dest, expectedSha1, attempt + 1));
              return reject(new Error(`SHA1 mismatch: ${url}`));
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
      }).on("error", async (err) => {
        file.close();
        if (fs.existsSync(dest)) await fsp.unlink(dest);
        reject(err);
      });
    });
  }

  async _json(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on("error", reject);
    });
  }

  async _loadVersionJSON() {
    const manifest = await this._json("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
    const versionInfo = manifest.versions.find(v => v.id === this.version);
    if (!versionInfo) throw new Error(`Versión '${this.version}' no encontrada`);
    return this._json(versionInfo.url);
  }

  _allowed(lib) {
    if (!lib.rules) return true;
    for (const rule of lib.rules) {
      if (rule.os?.name && rule.os.name !== this.platform) continue;
      return rule.action === "allow";
    }
    return false;
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

  async _process(libs) {
    let done = 0;
    const total = libs.length;
    const queue = [];
    let active = 0;

    const next = () => {
      done++;
      this.emit("progress", ((done / total) * 100).toFixed(1));
      queue.shift();
      if (libs.length) push(task(libs.shift()));
    };

    const task = lib => async () => {
      try {
        const nfo = this._asNative(lib);
        const isNative = !!nfo;

        let destJar, url, sha;
        if (isNative && !nfo.legacy) {
          const cls = nfo.classifier;
          destJar = this._destPath(lib, cls);
          url = lib.downloads.classifiers[cls].url;
          sha = lib.downloads.classifiers[cls].sha1;
        } else {
          destJar = this._destPath(lib);
          url = lib.downloads.artifact.url;
          sha = lib.downloads.artifact.sha1;
        }

        if (!destJar || !url) {
          this.emit("debug", `[LibrariesDownloader] ⚠ Ruta o URL faltante para ${lib.name}, se omite.`);
          return;
        }

        await this._download(url, destJar, sha);
      } catch (e) {
        this.emit("debug", `[LibrariesDownloader] ⚠ Error descargando ${lib.name}: ${e.message}`);
      } finally {
        active--;
        next();
      }
    };

    const push = work => {
      queue.push(work);
      if (active < this.concurrent) {
        active++;
        work();
      }
    };

    for (let i = 0; i < Math.min(this.concurrent, libs.length); i++) {
      push(task(libs.shift()));
    }

    await new Promise(resolve => {
      const interval = setInterval(() => {
        if (queue.length === 0 && active === 0) {
          clearInterval(interval);
          resolve();
        }
      }, 100);
    });
  }

  async start() {
    try {
      await fsp.mkdir(this.libDir, { recursive: true });
      const versionJson = await this._loadVersionJSON();

      // Corregir la ruta de launchwrapper SI existe en la lista
      // Cambiar la ruta duplicada que da el JSON para launchwrapper
      if (versionJson.libraries) {
        for (const lib of versionJson.libraries) {
          if (lib.name === "net.minecraft:launchwrapper:1.12" && lib.downloads.artifact) {
            // Reemplazar la ruta incorrecta (launchwrapper/launchwrapper/1.12) por launchwrapper/1.12
            const origPath = lib.downloads.artifact.path;
            const fixedPath = origPath.replace(/launchwrapper\/launchwrapper\//, "launchwrapper/");
            if (origPath !== fixedPath) {
              this.emit("debug", `[LibrariesDownloader] Corrigiendo ruta launchwrapper: ${origPath} -> ${fixedPath}`);
              lib.downloads.artifact.path = fixedPath;
            }
          }
        }
      }

      const libs = (versionJson.libraries || []).filter(lib => this._allowed(lib));
      await this._process(libs);
      this.emit("done", "✅ Todas las librerías descargadas correctamente.");
    } catch (e) {
      this.emit("error", e.message);
    }
  }
}

module.exports = (root, version, opts) => new LibrariesDownloader(root, version, opts);
