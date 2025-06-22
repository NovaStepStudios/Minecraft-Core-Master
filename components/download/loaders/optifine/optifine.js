const fs   = require("fs");
const fsp  = fs.promises;
const path = require("path");
const os   = require("os");
const axios   = require("axios");
const cheerio = require("cheerio");

/* ─────────────── CONST ─────────────── */
const ROOT_URL = "https://optifine.net/downloads";
const BASE_URL = "https://optifine.net";

/* ──────────── MAIN CLASS ───────────── */
class OptiFine {
  /**
   * Descarga e instala OptiFine silenciosamente.
   * @param {string} mcVer            – ej. "1.20.1"
   * @param {string|null} destDir     – carpeta .minecraft (null → auto)
   * @param {boolean} cleanInstaller  – eliminar installer al final
   * @param {boolean} allowPreview    – usar preview si no hay estable
   */
  async downloadAndInstall(mcVer, destDir = null, cleanInstaller = true, allowPreview = true) {
    const mcDir = path.resolve(destDir ?? this.#defaultMcDir());
    const modsDir = path.join(mcDir, "mods");
    await fsp.mkdir(modsDir, { recursive: true });
    console.log(`Buscando OptiFine para Minecraft ${mcVer}…`);
    const meta = await this.#resolveBuild(mcVer, allowPreview);
    if (!meta) throw new Error(`No se encontró OptiFine para ${mcVer}`);
    const installerPath = path.join(modsDir, meta.installerName);
    await this.#downloadInstaller(meta, installerPath);
    console.log("OptiFine installer guardado en mods:", installerPath);
    await this.#ensureLauncherProfiles(mcDir);
  }
  async #resolveBuild(mcVer, allowPreview) {
    const html = await axios.get(ROOT_URL, { timeout: 15000 }).then(r => r.data);
    const $ = cheerio.load(html);
    let info = null;
    $("h2").each((_, h2) => {
      if (!$(h2).text().includes(mcVer)) return;
      const row = $(h2).nextAll("table.downloadTable")
                      .find("tr.downloadLineMain, tr.downloadLinePreview")
                      .first();
      if (!row.length) return;
      const isPreview = row.hasClass("downloadLinePreview");
      if (isPreview && !allowPreview) return;
      const mirrorRel = row.find("td.colMirror a").attr("href");
      if (!mirrorRel) return;
      const mirrorPage = new URL(mirrorRel, BASE_URL).toString();
      info = { mirrorPage };
    });
    if (!info) return null;
    const mirrorHtml = await axios.get(info.mirrorPage, { timeout: 15000 }).then(r => r.data);
    const $$ = cheerio.load(mirrorHtml);
    const anchor = $$(`#Download a[href^="downloadx?f="]`).first();
    const href = anchor.attr("href");
    if (!href) throw new Error("No se encontró enlace downloadx");
    const downloadUrl = new URL(href, BASE_URL).toString();
    const installerName = new URL(downloadUrl).searchParams.get("f"); // ej: OptiFine_1.20.1_HD_U_I6_installer.jar
    return { downloadUrl, installerName, mirrorPage: info.mirrorPage };
  }
  async #downloadInstaller(meta, dest) {
    if (fs.existsSync(dest)) {
      console.log("Installer ya existe – omitido");
      return;
    }
    console.log(`Descargando installer…`);
    const res = await axios.get(meta.downloadUrl, {
      headers: { Referer: meta.mirrorPage },
      responseType: "stream",
      timeout: 60000,
    });
    await new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(dest);
      res.data.pipe(writer);
      writer.on("finish", resolve);
      writer.on("error", reject);
    });
  }
  async #ensureLauncherProfiles(mcDir) {
    const filePath = path.join(mcDir, "launcher_profiles.json");
    const stub = {
      profiles: {},
      selectedProfile: "optifine",
      clientToken: "generated-by-minecraft-core-master",
    };
    if (!fs.existsSync(filePath)) {
      await fsp.writeFile(filePath, JSON.stringify(stub, null, 2));
      console.log("launcher_profiles.json creado");
      return;
    }
    try {
      const current = JSON.parse(await fsp.readFile(filePath, "utf8"));
      await fsp.writeFile(filePath, JSON.stringify({ ...stub, ...current }, null, 2));
      console.log("launcher_profiles.json fusionado");
    } catch {
      await fsp.rename(filePath, filePath + ".bak");
      await fsp.writeFile(filePath, JSON.stringify(stub, null, 2));
      console.log("Perfil corrupto → backup y regenerado");
    }
  }
  #defaultMcDir() {
    const home = os.homedir();
    switch (os.platform()) {
      case "win32": return path.join(process.env.APPDATA, ".minecraft");
      case "darwin": return path.join(home, "Library/Application Support/minecraft");
      default:       return path.join(home, ".minecraft");
    }
  }
  async #safeUnlink(p) {
    try {
      await fsp.unlink(p);
    } catch {}
  }
}

module.exports = new OptiFine();
