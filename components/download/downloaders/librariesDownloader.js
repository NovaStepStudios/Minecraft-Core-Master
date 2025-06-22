const fs             = require("fs");
const fsp            = fs.promises;
const path           = require("path");
const https          = require("https");
const os             = require("os");
const crypto         = require("crypto");
const unzipper       = require("unzipper");
const EventEmitter   = require("events");

class LibrariesDownloader extends EventEmitter {
  constructor(root, version, { concurrency = 4 } = {}) {
    super();
    this.root   = root;
    this.version = version;
    this.libDir = path.join(root, "libraries");
    this.nativeRoot = path.join(root, "natives");
    this.concurrent = concurrency;

    this.platform = (() => {
      switch (os.platform()) {
        case "win32": return "windows";
        case "darwin": return "osx";
        case "linux": return "linux";
        default:      return null;
      }
    })();

    this.arch = (() => {
      switch (os.arch()) {
        case "x64":   return "64";
        case "arm64": return "arm64";
        case "ia32":  return "32";
        default:      return "64";
      }
    })();
  }

  /* ---------------------------------------------------------- utils */
  static _sha1(file) {
    return new Promise((res, rej) => {
      const hash = crypto.createHash("sha1");
      const s = fs.createReadStream(file);
      s.on("error", rej);
      s.on("data", d => hash.update(d));
      s.on("end",   () => res(hash.digest("hex")));
    });
  }

  async _download(url, dest, expectedSha1) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });

    if (fs.existsSync(dest) && expectedSha1) {
      if ((await LibrariesDownloader._sha1(dest)) === expectedSha1) return;
      await fsp.unlink(dest);
    }

    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close(); fs.existsSync(dest) && fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode} → ${url}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", err => {
        fs.existsSync(dest) && fs.unlinkSync(dest);
        reject(err);
      });
    });
  }

  async _unzip(jar, dest) {
    await fsp.mkdir(dest, { recursive: true });
    return new Promise((ok, err) => {
      fs.createReadStream(jar)
        .pipe(unzipper.Extract({ path: dest }))
        .on("close", ok)
        .on("error", err);
    });
  }

  /* ---------------------------------------------------------- manifest helpers */
  async _json(url) {
    return new Promise((res, rej) => {
      https.get(url, r => {
        if (r.statusCode !== 200) return rej(Error(`HTTP ${r.statusCode}`));
        let d = ""; r.on("data", c => d += c);
        r.on("end", () => { try { res(JSON.parse(d)); } catch(e){ rej(e);} });
      }).on("error", rej);
    });
  }

  async _loadVersionJSON() {
    const manifest = await this._json("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
    const v = manifest.versions.find(v => v.id === this.version);
    if (!v) throw Error(`Versión '${this.version}' no encontrada`);
    return this._json(v.url);
  }

  /* ---------------------------------------------------------- main API */
  async start() {
    try {
      await fsp.mkdir(this.libDir,   { recursive: true });
      await fsp.mkdir(this.nativeRoot, { recursive: true });

      const versionJson = await this._loadVersionJSON();

      const allLibs = versionJson.libraries || [];
      const libsFiltered = allLibs.filter(l => this._allowed(l));

      await this._process(libsFiltered);

      this.emit("done", "Todas las librerías descargadas / nativos extraídos");
    } catch (e) {
      this.emit("error", e.message || e);
    }
  }

  /* ---------------------------------------------------------- processing */
  _allowed(lib) {
    if (!lib.rules) return true;
    // aplica la última regla coincidente
    let allowed = false;
    for (const r of lib.rules) {
      if (r.os && r.os.name && r.os.name !== this.platform) continue;
      allowed = r.action === "allow";
    }
    return allowed;
  }

  /**
   * Detecta si la entrada representa un *natives*:
   *  1. Caso “moderno”: tiene `natives{}` + `classifiers`
   *  2. Caso “legacy”: name termina en `:natives-{platform}` y **NO** trae `natives{}`
   */
  _asNative(lib) {
    // 1)
    if (lib.natives && lib.natives[this.platform]) {
      const key = lib.natives[this.platform].replace("${arch}", this.arch);
      return { classifier: key, legacy: false };
    }
    // 2) detectar pattern en el nombre
    const m = lib.name.match(/:natives-([a-zA-Z0-9_\-]+)$/);
    if (m) return { classifier: null, legacy: true };
    return null;
  }

  _destPath(lib, classifier = null) {
    if (classifier) return path.join(this.libDir, lib.downloads.classifiers[classifier].path);
    return path.join(this.libDir, lib.downloads.artifact.path);
  }

  async _process(libs) {
    let done = 0, total = libs.length;

    const queue = [];
    const push = work => {
      queue.push(work);
      if (queue.length <= this.concurrent) work();
    };

    const next = () => {
      done++;
      this.emit("progress", `${((done/total)*100).toFixed(1)}%`);
      queue.shift();
      if (libs.length) push(task(libs.shift()));
    };

    const task = lib => async () => {
      try {
        const nfo = this._asNative(lib);
        if (nfo && !nfo.legacy) {
          // modo moderno (classifiers)
          const cls = nfo.classifier;
          const destJar = this._destPath(lib, cls);
          const url = lib.downloads.classifiers[cls].url;
          const sha = lib.downloads.classifiers[cls].sha1;
          await this._download(url, destJar, sha);
          const nativeDir = path.join(this.nativeRoot, this.version);
          await this._unzip(destJar, nativeDir);
        } else if (nfo && nfo.legacy) {
          // modo legacy (name …:natives-*)
          const destJar = this._destPath(lib);   // artifact directamente
          const sha = lib.downloads.artifact.sha1;
          await this._download(lib.downloads.artifact.url, destJar, sha);
          const nativeDir = path.join(this.nativeRoot, this.version);
          await this._unzip(destJar, nativeDir);
        } else {
          // librería normal (classpath)
          const destJar = this._destPath(lib);
          const sha = lib.downloads.artifact.sha1;
          await this._download(lib.downloads.artifact.url, destJar, sha);
        }
      } catch(e){ this.emit("error", e.message); }
      finally   { next(); }
    };

    // iniciar
    for (let i=0;i<Math.min(this.concurrent, libs.length);i++) push(task(libs.shift()));

    // esperar cola vacía
    await new Promise(ok => {
      const int = setInterval(()=>{ if(!queue.length) {clearInterval(int); ok();}}, 200);
    });
  }
}

module.exports = (root, version, opts) => new LibrariesDownloader(root, version, opts);
