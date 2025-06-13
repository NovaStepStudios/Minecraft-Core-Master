const { MinecraftDownloader } = require("../index");

const downloaderMC = new MinecraftDownloader("./Minecraft", false, "old_alpha");

downloaderMC.on("progress", (message) => {
  console.log(`[Progreso] ${message}`);
});

downloaderMC.on("error", (err) => {
  console.error(`Error crítico: ${err}`);
});

downloaderMC.download("1.8.9").then(() => {
  console.log("Descarga completada!");
});