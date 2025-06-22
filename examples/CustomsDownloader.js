const { CustomInstaller } = require('../index.js');

const downloader = new CustomInstaller("./Minecraft", "1.21.6-56.0.7", "Forge");

downloader.on("progress", (data) => console.log("[Progreso]", data));
downloader.on("done", (msg) => console.log("[✔]", msg));
downloader.on("error", (err) => console.error("[❌]", err));

downloader.start().then(() => {
  console.log("✅ Descarga completada");
}).catch((err) => {
  console.error(`❌ Error crítico: ${err}`);
});
