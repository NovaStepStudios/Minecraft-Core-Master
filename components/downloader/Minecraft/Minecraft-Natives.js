"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const EventEmitter = require("events");
const unzipper = require("unzipper");

class MinecraftNativesDownloader extends EventEmitter {
  constructor(root, version) {
    super();
    this.root = root;
    this.version = version;
    this.destDir = path.join(root, "natives", version);
    this.currentOS = this.#mapOS(os.platform());
    this.currentArch = os.arch(); // 'x64', 'arm64', 'ia32'
  }

  async start() {
    try {
      await this.#ensureDir(this.destDir);

      const manifest = await this.#fetchJSON("https://piston-meta.mojang.com/mc/game/version_manifest_v2.json");
      const versionMeta = manifest.versions.find(v => v.id === this.version);
      if (!versionMeta) throw new Error(`Versión ${this.version} no encontrada.`);

      const versionJSON = await this.#fetchJSON(versionMeta.url);
      const libraries = versionJSON.libraries || [];

      const nativeLibs = libraries.filter(lib => this.#isNativeLibrary(lib));
      let downloaded = 0;

      for (const lib of nativeLibs) {
        const url = this.#getNativeDownloadURL(lib);
        if (!url) {
          downloaded++;
          this.#emitProgress(downloaded, nativeLibs.length);
          continue;
        }

        const jarName = path.basename(url);
        const jarPath = path.join(this.destDir, jarName);

        if (!fs.existsSync(jarPath)) {
          await this.#downloadFile(url, jarPath);
        }

        await this.#extractNativeFiles(jarPath, this.destDir);
        downloaded++;
        this.#emitProgress(downloaded, nativeLibs.length);
      }

      this.emit("done");
    } catch (err) {
      this.emit("error", err);
    }
  }

  #mapOS(platform) {
    switch (platform) {
      case "win32": return "windows";
      case "darwin": return "osx";
      case "linux": return "linux";
      default: return platform;
    }
  }

  #isNativeLibrary(lib) {
    return (
      lib.name.includes(":natives") ||
      (lib.downloads?.classifiers && Object.keys(lib.downloads.classifiers).some(k => k.startsWith("natives-")))
    );
  }

  #matchesRules(rules) {
    if (!rules) return true;

    let allowed = null;

    for (const rule of rules) {
      if (!rule.os) {
        allowed = rule.action === "allow";
        continue;
      }

      if (rule.os.name && rule.os.name !== this.currentOS) continue;

      allowed = rule.action === "allow";
    }

    return allowed ?? true;
  }

  #getNativeDownloadURL(lib) {
    if (!this.#matchesRules(lib.rules)) return null;

    // Nuevas versiones: artifact directo con nombre :natives-*
    if (lib.downloads?.artifact && lib.name.includes(":natives")) {
      const arch = this.#mapArchForURL();
      const nativeName = `natives-${this.currentOS}${arch ? "-" + arch : ""}`;
      if (lib.name.includes(nativeName)) {
        return lib.downloads.artifact.url;
      }
    }

    // Viejas versiones: classifiers
    if (lib.downloads?.classifiers) {
      const arch = this.#mapArchForURL();
      const keysToTry = [
        `natives-${this.currentOS}-${arch}`,
        `natives-${this.currentOS}`,
      ];

      for (const key of keysToTry) {
        if (lib.downloads.classifiers[key]) {
          return lib.downloads.classifiers[key].url;
        }
      }
    }

    return null;
  }

  #mapArchForURL() {
    // Traducir arch de Node.js a la de Mojang
    if (this.currentOS === "windows") {
      if (this.currentArch === "arm64") return "arm64";
      if (this.currentArch === "ia32") return "x86";
    }
    return ""; // macOS y Linux generalmente no usan sufijos
  }

  async #extractNativeFiles(jarPath, destDir) {
    return new Promise((resolve, reject) => {
      fs.createReadStream(jarPath)
        .pipe(unzipper.Parse())
        .on("entry", entry => {
          const name = entry.path;
          const ext = path.extname(name).toLowerCase();

          // Extensiones válidas de nativos
          const validExt = [".dll", ".so", ".dylib", ".jnilib", ".jar"];
          if (!validExt.includes(ext)) {
            entry.autodrain();
            return;
          }

          // Filtrado por arquitectura/plataforma:
          // Si el nombre contiene un sufijo de otra arquitectura, ignorar.
          // Ejemplos de sufijos: -arm64, -x86, -x64, -windows-32
          // Esto puede ajustarse según necesidades específicas.

          const lowerName = name.toLowerCase();

          // Windows 64 bits (x64)
          if (this.currentOS === "windows" && this.currentArch === "x64") {
            if (lowerName.includes("arm64") || lowerName.includes("x86") || lowerName.includes("windows-32")) {
              entry.autodrain();
              return;
            }
          }

          // Windows 32 bits (ia32)
          if (this.currentOS === "windows" && this.currentArch === "ia32") {
            // Para 32 bits tal vez aceptar solo -windows-32
            if (!lowerName.includes("windows-32")) {
              entry.autodrain();
              return;
            }
          }

          // Linux y macOS ARM64 o x64, similar
          if (this.currentOS === "linux" || this.currentOS === "osx") {
            if (this.currentArch === "x64") {
              if (lowerName.includes("arm64")) {
                entry.autodrain();
                return;
              }
            } else if (this.currentArch === "arm64") {
              if (lowerName.includes("x86") || lowerName.includes("x64")) {
                entry.autodrain();
                return;
              }
            }
          }

          // Si pasa el filtrado, extraer el archivo
          const filePath = path.join(destDir, path.basename(name));
          entry.pipe(fs.createWriteStream(filePath));
        })
        .on("close", resolve)
        .on("error", reject);
    });
  }


  async #downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          return reject(new Error(`Fallo al descargar: ${url}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      }).on("error", err => {
        file.close();
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }

  async #fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} - ${url}`));
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(err);
          }
        });
      }).on("error", reject);
    });
  }

  async #ensureDir(dir) {
    await fs.promises.mkdir(dir, { recursive: true });
  }

  #emitProgress(current, total) {
    const percent = ((current / total) * 100).toFixed(2);
    this.emit("progress", { current, total, percent });
  }
}

module.exports = MinecraftNativesDownloader;
