const { MinecraftDownloader } = require('../index.js');

const downloaderMC = new MinecraftDownloader("./Minecraft", "Java24", "release");
  downloaderMC.on("progress", (message) => {
  console.log(`[Progreso] ${message}`);
});
downloaderMC.start("1.20.4").then(() => {
  console.log("Descarga completada!");
}).catch((err) => {
  console.error(`Error crítico: ${err}`);
});