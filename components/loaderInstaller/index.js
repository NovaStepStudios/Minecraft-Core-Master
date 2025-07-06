const EventEmitter = require("events");
const OptiFine = require("./optifine/optifine.js");
const Forge = require("./forge/forge.js");

class LoaderInstaller  extends EventEmitter {
  /**
   * @param {string} destDir - ruta destino para instalar, ej: "./Minecraft"
   * @param {string} version - versión, ej: "1.20.4"
   * @param {string} modType - "Forge" | "Optifine"
   */
  constructor(destDir, version, modType) {
    super();
    this.destDir = destDir;
    this.version = version;
    this.modType = modType;
  }

  async start() {
    try {
      this.emit("progress", {
        step: "start",
        message: `Iniciando instalación de Minecraft ${this.version} con ${this.modType} en ${this.destDir}`,
      });

      if (this.modType === "Optifine") {
        this.emit("progress", { step: "mod-install", message: "Instalando OptiFine..." });
        await OptiFine.downloadAndInstall(this.version, this.destDir);
        this.emit("progress", { step: "mod-install", message: "OptiFine instalado correctamente" });
      } else if (this.modType === "Forge") {
        this.emit("progress", { step: "mod-install", message: "Instalando Forge..." });
        await Forge.downloadAndInstall(this.version, this.destDir);
        this.emit("progress", { step: "mod-install", message: "Forge instalado correctamente" });
      } else {
        this.emit("progress", { step: "mod-install", message: "Tipo de mod no válido o no definido" });
      }

      this.emit("done", { message: "Instalación finalizada exitosamente" });
    } catch (error) {
      this.emit("error", error);
    }
  }
}

module.exports = LoaderInstaller ;
