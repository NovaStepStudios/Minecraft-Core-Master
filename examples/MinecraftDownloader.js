const { MinecraftDownloader } = require("../index");

const Downloading = new MinecraftDownloader("./Minecraft", false, "release");

Downloading.on("progress", (message) => {
  console.log(`[Progreso] ${message}`);
});

Downloading.on("error", (err) => {
  console.error(`Error crítico: ${err}`);
});

Downloading.download("1.12.2").then(() => {
  console.log("Descarga completada!");
});