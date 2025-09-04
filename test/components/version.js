const { MinecraftClientDownloader } = require("../../dist/Minecraft/Version");

const rootPath = ".minecraftTest";
const version = "1.20.1";

const clientDownloader = new MinecraftClientDownloader(rootPath, version);

clientDownloader.on("progress", (data) => {
  console.log(`[PROGRESO] Paso ${data.current} de ${data.total} | Progreso: ${data.percent.toFixed(2)}%`);
});

clientDownloader.on("error", (err) => console.error("❌ ERROR:", err.message));
clientDownloader.on("done", () => console.log("✅ Cliente de Minecraft descargado correctamente!"));

clientDownloader.start().catch((err) => console.error(err));
