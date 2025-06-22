const fs = require("fs");
const path = require("path");
const os = require("os");
const https = require("https");
const EventEmitter = require("events");
const unzipper = require("unzipper");

class NativesDownloader extends EventEmitter {
  constructor(rootPath, version) {
    super();
    this.rootPath   = rootPath;
    this.version    = version;
    this.platform   = this.#detectPlatform();      // windows | linux | osx | unknown
    this.nativesDir = path.join(rootPath, "natives", version);
    this.totalBytes = 0;
    this.doneBytes  = 0;
  }

  #detectPlatform() {
    const p = os.platform();
    if (p === "win32")  return "windows";
    if (p === "darwin") return "osx";
    if (p === "linux")  return "linux";
    return "unknown";
  }

  async start() {
    if (this.platform === "unknown") {
      this.emit("error", "Plataforma no reconocida para descargar nativos.");
      return;
    }

    this.emit("progress", `0.0%`); 

    try {
      await fs.promises.mkdir(this.nativesDir, { recursive: true });

      // 1. Obtener manifest general y versión concreta
      const versionManifest = await this.#fetchJSON("https://launchermeta.mojang.com/mc/game/version_manifest.json");
      const versionEntry = versionManifest.versions.find(v => v.id === this.version);
      if (!versionEntry) throw new Error(`Versión ${this.version} no encontrada en manifest`);

      // 2. Obtener JSON versión
      const versionJson = await this.#fetchJSON(versionEntry.url);

      // 3. Filtrar librerías nativas para plataforma
      const nativeLibs = (versionJson.libraries || []).filter(lib => {
        if (!lib.name.includes(":natives-")) return false;
        if (!lib.downloads?.artifact?.url) return false;
        const rules = lib.rules || [];
        if (rules.length === 0) return true; 
        return rules.some(r => r.action === "allow" && r.os?.name === this.platform);
      });

      if (nativeLibs.length === 0) {
        this.emit("progress", `100.0%`);
        this.emit("done",  "Sin nativos para esta plataforma");
        return;
      }

      // 4. Calcular bytes totales a descargar (solo archivos que no existan)
      this.totalBytes = 0;
      for (const lib of nativeLibs) {
        const art = lib.downloads.artifact;
        const zipPath = path.join(this.nativesDir, path.basename(art.path));
        let stat = null;
        try { stat = await fs.promises.stat(zipPath); } catch {}
        if (!stat || stat.size !== art.size) this.totalBytes += art.size || 0;
      }
      if (this.totalBytes === 0) this.totalBytes = 1; // evitar división por cero

      // 5. Descargar y extraer secuencialmente (podés paralelizar si querés)
      for (const lib of nativeLibs) {
        const art = lib.downloads.artifact;
        const zipPath = path.join(this.nativesDir, path.basename(art.path));

        const needsDownload = !(await this.#fileExistsWithSize(zipPath, art.size));
        if (needsDownload) {
          this.emit("progress", `Descargando nativo: ${lib.name}`);
          await this.#downloadFile(art.url, zipPath);
        } else {
          this.emit("progress", `Nativo ya descargado: ${lib.name}`);
        }

        this.emit("progress", `Extrayendo nativo: ${lib.name}`);
        await this.#extractFlat(zipPath, this.nativesDir);

        // Opcional borrar zip para ahorrar espacio
        // await fs.promises.unlink(zipPath).catch(() => {});
      }

      this.emit("progress", `100.0%`);
      this.emit("done",  "Nativos descargados y extraídos correctamente.");
    } catch (e) {
      this.emit("error", e.message);
    }
  }

  async #fileExistsWithSize(filePath, expectedSize) {
    try {
      const stat = await fs.promises.stat(filePath);
      return stat.size === expectedSize;
    } catch {
      return false;
    }
  }

  #fetchJSON(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} al descargar JSON: ${url}`));
        }
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error("Error parseando JSON: " + e.message));
          }
        });
      }).on("error", err => reject(err));
    });
  }

  #downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const file = fs.createWriteStream(dest);

      https.get(url, res => {
        if (res.statusCode !== 200) {
          file.close();
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          return reject(new Error(`HTTP ${res.statusCode} al descargar: ${url}`));
        }

        res.on("data", chunk => {
          this.doneBytes += chunk.length;
          const pct = ((this.doneBytes / this.totalBytes) * 100).toFixed(1);
          this.emit("progress", `${pct}%`);
        });

        res.pipe(file);

        file.on("finish", () => file.close(resolve));
        file.on("error", err => {
          if (fs.existsSync(dest)) fs.unlinkSync(dest);
          reject(err);
        });
      }).on("error", err => {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    });
  }

  async #extractFlat(zipPath, destDir) {
    const zip = fs.createReadStream(zipPath).pipe(unzipper.Parse({ forceStream: true }));

    for await (const entry of zip) {
      // Ignorar directorios y META-INF
      if (entry.type === "Directory" || entry.path.includes("META-INF")) {
        entry.autodrain();
        continue;
      }
      const fileName = path.basename(entry.path);
      const outPath = path.join(destDir, fileName);

      // Sobrescribir siempre (podés añadir checks si querés)
      await fs.promises.writeFile(outPath, await entry.buffer());
    }
  }
}

module.exports = NativesDownloader;
