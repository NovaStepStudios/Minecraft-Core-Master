const { MinecraftDownloader } = require("./../components/DownloadMc.js");

const Downloading = new MinecraftDownloader("./Minecraft", true, "release");

Downloading.on("progress", (message) => {
  console.log(`[Progreso] ${message}`);
});

Downloading.on("error", (err) => {
  console.error(`Error crítico: ${err}`);
});

Downloading.download("1.21.5").then(() => {
  console.log("Descarga completada!");
});
