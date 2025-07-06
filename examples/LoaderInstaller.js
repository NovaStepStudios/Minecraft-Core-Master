const { LoaderInstaller  } = require('../index.js');

const downloader = new LoaderInstaller ("./Minecraft", "1.12.2-14.23.5.2860", "Forge");

downloader.on("progress", (data) => console.log("[Progreso]", data));
downloader.on("done", (msg) => console.log("[Completado]", msg));
downloader.on("error", (err) => console.error("[Error]", err));

downloader.start().then(() => {
  console.log("Descarga completada");
}).catch((err) => {
  console.error(`Error crítico: ${err}`);
});
