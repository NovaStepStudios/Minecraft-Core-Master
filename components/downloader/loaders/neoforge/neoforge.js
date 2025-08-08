"use strict";
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const cheerio = require("cheerio");

const BASE_URL = "https://maven.neoforged.net/releases/net/neoforged/neoforge/";

class NeoForgeInstaller {
  constructor(minecraftPath, mcVersion = null, outputDir = null) {
    this.minecraftPath = path.resolve(minecraftPath);
    this.mcVersion = mcVersion; // null = última versión
    this.outputDir = outputDir
      ? path.resolve(outputDir)
      : path.join(this.minecraftPath, "temp", "neoforge");

    this.neoforgeVersion = null;
    this.installerUrl = null;
    this.installerPath = null;
  }

  isInstalled() {
    const versionDir = path.join(this.minecraftPath, "versions", this.mcVersion);
    return fs.existsSync(versionDir);
  }

  async fetchHtml(url) {
    return new Promise((resolve, reject) => {
      https
        .get(url, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} en ${url}`));
            res.resume();
            return;
          }
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => resolve(data));
        })
        .on("error", reject);
    });
  }

  async listVersions() {
    const html = await this.fetchHtml(BASE_URL);
    const $ = cheerio.load(html);
    const versions = [];

    $("a").each((_, el) => {
      const href = $(el).attr("href");
      if (
        href &&
        href.endsWith("/") &&
        !href.startsWith("?") &&
        !href.startsWith("/")
      ) {
        const v = href.replace("/", "");
        if (/^\d/.test(v)) {
          versions.push(v);
        }
      }
    });

    if (versions.length === 0) {
      throw new Error("No se encontraron versiones NeoForge en el índice.");
    }

    versions.sort((a, b) => {
      const normalize = (ver) =>
        ver
          .replace(/-beta$/, ".0-beta")
          .split(/[.-]/)
          .map((x) => (isNaN(x) ? x : Number(x)));
      const na = normalize(a);
      const nb = normalize(b);

      for (let i = 0; i < Math.max(na.length, nb.length); i++) {
        if (na[i] === undefined) return -1;
        if (nb[i] === undefined) return 1;
        if (na[i] < nb[i]) return -1;
        if (na[i] > nb[i]) return 1;
      }
      return 0;
    });

    return versions;
  }

  async selectVersion() {
    if (this.mcVersion) {
      console.log(`[NeoForgeInstaller] Versión solicitada: ${this.mcVersion}`);
      return this.mcVersion;
    }
    const versions = await this.listVersions();
    const lastVersion = versions[versions.length - 1];
    console.log(`[NeoForgeInstaller] Última versión disponible: ${lastVersion}`);
    return lastVersion;
  }

  async downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const file = fs.createWriteStream(dest);

      https
        .get(url, (res) => {
          if (res.statusCode === 302 || res.statusCode === 301) {
            https.get(res.headers.location, (redirRes) => {
              redirRes.pipe(file);
              file.on("finish", () => file.close(resolve));
            });
            return;
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Error HTTP ${res.statusCode} descargando ${url}`));
            res.resume();
            return;
          }
          res.pipe(file);
          file.on("finish", () => file.close(resolve));
        })
        .on("error", (err) => {
          fs.unlink(dest, () => reject(err));
        });
    });
  }

  async prepare() {
    this.neoforgeVersion = await this.selectVersion();

    this.installerUrl = `${BASE_URL}${this.neoforgeVersion}/neoforge-${this.neoforgeVersion}-installer.jar`;
    this.installerPath = path.join(
      this.outputDir,
      `neoforge-${this.neoforgeVersion}-installer.jar`
    );

    fs.mkdirSync(this.outputDir, { recursive: true });
  }

  async downloadInstaller() {
    if (fs.existsSync(this.installerPath)) {
      console.log(`[NeoForgeInstaller] Instalador ya existe: ${this.installerPath}`);
      return;
    }
    console.log(`[NeoForgeInstaller] Descargando instalador ${this.neoforgeVersion}...`);
    await this.downloadFile(this.installerUrl, this.installerPath);
  }

  runInstaller() {
    return new Promise((resolve, reject) => {
      const java = "java";
      const args = ["-jar", this.installerPath, "--installClient", this.minecraftPath];

      console.log(`[NeoForgeInstaller] Ejecutando: java ${args.join(" ")}`);

      const proc = spawn(java, args, { stdio: "inherit" });

      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Instalador terminó con código ${code}`));
      });
    });
  }

  async install() {
    if (this.isInstalled()) {
      console.log(`[NeoForgeInstaller] NeoForge ${this.mcVersion} ya instalado.`);
      return;
    }
    try {
      await this.prepare();
      await this.downloadInstaller();
      await this.runInstaller();
      console.log("[NeoForgeInstaller] Instalación completa.");
    } catch (err) {
      console.error("[NeoForgeInstaller] Error en instalación:", err);
      throw err;
    }
  }

  static async run(minecraftPath, mcVersion) {
    const installer = new NeoForgeInstaller(minecraftPath, mcVersion);
    try {
      await installer.install();
      console.log("Instalación finalizada con éxito.");
      process.exit(0);
    } catch (err) {
      console.error("Error en la instalación:", err);
      process.exit(1);
    }
  }
}

module.exports = NeoForgeInstaller;
