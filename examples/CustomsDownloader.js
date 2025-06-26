const { CustomInstaller } = require('../index.js');

const downloader = new CustomInstaller("./Minecraft", "1.21.6-56.0.8", "Forge");

downloader.on("progress", (data) => console.log("[Progreso]", data));
downloader.on("done", (msg) => console.log("[Completado]", msg));
downloader.on("error", (err) => console.error("[Error]", err));

downloader.start().then(() => {
  console.log("Descarga completada");
}).catch((err) => {
  console.error(`Error crítico: ${err}`);
});
