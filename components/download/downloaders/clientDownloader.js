const fs = require("fs");
const path = require("path");
const https = require("https");
const EventEmitter = require("events");

class ClientDownloader extends EventEmitter {
  constructor(root, version) {
    super();
    this.root = root;
    this.version = version;
    this.versionsPath = path.join(root, "versions", version);
    this.jarPath = path.join(this.versionsPath, `${version}.jar`);
    this.jsonPath = path.join(this.versionsPath, `${version}.json`);
  }

  async start() {
    try {
      this.#createFolders();

      // Obtener solo entry del manifest para la versión (sin descargar JSON completo aún)
      const versionEntry = await this.#fetchVersionEntry(this.version);
      if (!versionEntry?.url) {
        throw new Error(`No se encontró URL JSON para la versión ${this.version}`);
      }

      // Descargar JSON de la versión y guardarlo
      const versionJson = await this.#fetchJson(versionEntry.url);
      fs.writeFileSync(this.jsonPath, JSON.stringify(versionJson, null, 2));

      if (!versionJson?.downloads?.client?.url) {
        throw new Error(`No se encontró URL de client.jar para la versión ${this.version}`);
      }

      // Descargar client.jar con progreso
      await this.#downloadFileWithProgress(versionJson.downloads.client.url, this.jarPath);

      this.emit("done", `Client.jar y JSON de versión '${this.version}' descargados correctamente.`);
    } catch (err) {
      this.emit("error", err.message);
    }
  }

  #createFolders() {
    if (!fs.existsSync(this.versionsPath)) {
      fs.mkdirSync(this.versionsPath, { recursive: true });
    }
  }

  // Solo obtiene la entry del manifest, no el JSON completo
  async #fetchVersionEntry(version) {
    const manifestURL = "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json";
    const manifest = await this.#fetchJson(manifestURL);
    const versionEntry = manifest.versions.find(v => v.id === version);
    if (!versionEntry) throw new Error(`Versión '${version}' no encontrada en manifest.`);
    return versionEntry;
  }

  // Descarga JSON y parsea
  #fetchJson(url) {
    return new Promise((resolve, reject) => {
      https.get(url, res => {
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} al descargar: ${url}`));
          return;
        }
        let data = "";
        res.on("data", chunk => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Error al parsear JSON"));
          }
        });
      }).on("error", reject);
    });
  }

  #downloadFileWithProgress(url, dest) {
    return new Promise((resolve, reject) => {
      const options = new URL(url);
      options.family = 4; // IPv4

      const dir = path.dirname(dest);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      const file = fs.createWriteStream(dest);
      https.get(options, res => {
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${url}`));
        }

        const totalSize = parseInt(res.headers["content-length"], 10);
        let downloaded = 0;

        res.on("data", chunk => {
          downloaded += chunk.length;
          const percent = ((downloaded / totalSize) * 100).toFixed(1);
          this.emit("progress", `${percent}%`);
        });

        res.pipe(file);

        file.on("finish", () => {
          file.close(resolve);
        });
      }).on("error", err => {
        if (fs.existsSync(dest)) fs.unlinkSync(dest);
        reject(err);
      });
    });
  }
}

module.exports = (root, version) => new ClientDownloader(root, version);
