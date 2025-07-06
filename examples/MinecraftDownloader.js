const { MinecraftDownloader } = require('../index.js');

const downloaderMC = new MinecraftDownloader("./Minecraft", false, "release");
  downloaderMC.on("progress", (message) => {
  console.log(`[Progreso] ${message}`);});

downloaderMC.start("1.8.9").then(() => {
  console.log("Descarga completada!");
}).catch((err) => {
  console.error(`Error crítico: ${err}`);
});