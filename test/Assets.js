const MinecraftAssetsDownloader = require("../components/downloader/Minecraft/Minecraft-Assets");

const downloader = new MinecraftAssetsDownloader("./.minecraft", "1.20.4");

downloader.on("progress", ({ current, total, percent }) => {
  console.log(`[${current}/${total}] Descargado - ${percent}%`);
});

downloader.on("done", () => {
  console.log("✅ ¡Assets descargados con éxito!");
});

downloader.on("error", (err) => {
  console.error("❌ Error:", err);
});

downloader.start();
