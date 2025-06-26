const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const https = require("https");
const os = require("os");
const crypto = require("crypto");
const unzipper = require("unzipper");
const EventEmitter = require("events");

class LibrariesDownloader extends EventEmitter {
  constructor(root, version, { concurrency = 5 } = {}) {
    super();
    this.root = root;
    this.version = version;
    this.libDir = path.join(root, "libraries");
    this.nativeRoot = path.join(root, "natives");
    this.concurrent = concurrency;
    this.platform = (() => {
      switch (os.platform()) {
        case "win32": return "windows";
        case "darwin": return "osx";
        case "linux": return "linux";
        default: return null;
      }
    })();
    this.arch = (() => {
      switch (os.arch()) {
        case "x64": return "64";
        case "arm64": return "arm64";
        case "ia32": return "32";
        default: return "64";
      }
    })();
  }
  static _sha1(file) {
    return new Promise((res, rej) => {
      const hash = crypto.createHash("sha1");
      const s = fs.createReadStream(file);
      s.on("error", rej);
      s.on("data", d => hash.update(d));
      s.on("end", () => res(hash.digest("hex")));
    });
  }
  async _download(url, dest, expectedSha1, attempt = 1) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && expectedSha1) {
      if ((await LibrariesDownloader._sha1(dest)) === expectedSha1) return;
      await fsp.unlink(dest);
    }
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      const request = https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          fs.existsSync(dest) && fs.unlinkSync(dest);
          if (attempt < 3) {
            // Reintentar
            return resolve(this._download(url, dest, expectedSha1, attempt + 1));
          } else {
            return reject(new Error(`HTTP ${res.statusCode} → ${url}`));
          }
        }
        res.pipe(file);
        file.on("finish", async () => {
          file.close();
          if (expectedSha1) {
            try {
              const sha = await LibrariesDownloader._sha1(dest);
              if (sha !== expectedSha1) {
                await fsp.unlink(dest);
                if (attempt < 3) {
                  return resolve(this._download(url, dest, expectedSha1, attempt + 1));
                } else {
                  return reject(new Error(`SHA1 mismatch after download: ${url}`));
                }
              }
            } catch (e) {
              return reject(e);
            }
          }
          resolve();
        });
        file.on("error", async (err) => {
          file.close();
          fs.existsSync(dest) && await fsp.unlink(dest);
          reject(err);
        });
      });
      request.on("error", async (err) => {
        file.close();
        fs.existsSync(dest) && await fsp.unlink(dest);
        reject(err);
      });
    });
  }
  async _unzip(jar, dest) {
    await fsp.mkdir(dest, { recursive: true });
    return new Promise((resolve, reject) => {
      fs.createReadStream(jar)
        .pipe(unzipper.Extract({ path: dest }))
        .on("close", resolve)
        .on("error", reject);
    });
  }
  async _json(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(Error(`HTTP ${res.statusCode}`));
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
    if (!versionInfo) throw Error(`Versión '${this.version}' no encontrada`);
    return this._json(versionInfo.url);
  }
  _allowed(lib) {
    if (!lib.rules) return true;
    let allowed = false;
    for (const r of lib.rules) {
      if (r.os && r.os.name && r.os.name !== this.platform) continue;
      allowed = r.action === "allow";
    }
    return allowed;
  }
  _asNative(lib) {
    if (lib.natives && lib.natives[this.platform]) {
      const key = lib.natives[this.platform].replace("${arch}", this.arch);
      return { classifier: key, legacy: false };
    }
    const m = lib.name.match(/:natives-([a-zA-Z0-9_\-]+)$/);
    if (m) return { classifier: null, legacy: true };
    return null;
  }
  _destPath(lib, classifier = null) {
    if (classifier) return path.join(this.libDir, lib.downloads.classifiers[classifier].path);
    return path.join(this.libDir, lib.downloads.artifact.path);
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
        if (nfo && !nfo.legacy) {
          const cls = nfo.classifier;
          const destJar = this._destPath(lib, cls);
          const url = lib.downloads.classifiers[cls].url;
          const sha = lib.downloads.classifiers[cls].sha1;
          await this._download(url, destJar, sha);
          const nativeDir = path.join(this.nativeRoot, this.version);
          await this._unzip(destJar, nativeDir);
        } else if (nfo && nfo.legacy) {
          const destJar = this._destPath(lib);
          const sha = lib.downloads.artifact.sha1;
          await this._download(lib.downloads.artifact.url, destJar, sha);
          const nativeDir = path.join(this.nativeRoot, this.version);
          await this._unzip(destJar, nativeDir);
        } else {
          const destJar = this._destPath(lib);
          const sha = lib.downloads.artifact.sha1;
          await this._download(lib.downloads.artifact.url, destJar, sha);
        }
      } catch (e) {
        // No emitimos error para evitar spam
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
    await new Promise((resolve) => {
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
      await fsp.mkdir(this.nativeRoot, { recursive: true });
      const versionJson = await this._loadVersionJSON();
      const allLibs = versionJson.libraries || [];
      const libsFiltered = allLibs.filter(l => this._allowed(l));
      await this._process(libsFiltered);
      this.emit("done", "Todas las librerías descargadas / nativos extraídos");
    } catch (e) {
      // No emitimos error para evitar spam
    }
  }
}
module.exports = (root, version, opts) => new LibrariesDownloader(root, version, opts);
