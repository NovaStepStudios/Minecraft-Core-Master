<<<<<<< HEAD
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
=======
const { MinecraftDownloader } = require('../index.js');

const downloaderMC = new MinecraftDownloader("./Minecraft", "Java24", "release");
  downloaderMC.on("progress", (message) => {
  console.log(`[Progreso] ${message}`);
});

downloaderMC.start("1.20.4").then(() => {
  console.log("Descarga completada!");
}).catch((err) => {
  console.error(`Error crítico: ${err}`);
>>>>>>> d78a581 (Update All Project)
});