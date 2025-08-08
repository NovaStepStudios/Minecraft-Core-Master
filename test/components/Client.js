const MinecraftClientDownloader = require("../../components/downloader/Minecraft/Minecraft-Client");

const downloader = new MinecraftClientDownloader("./.minecraft", "1.20.4");

downloader.on("progress", p => {
  console.log(`[${p.current}/${p.total}] Descargado - ${p.percent}%`);
});
downloader.on("done", () => {
  console.log("✅ Cliente listo!");
});
downloader.on("error", console.error);

downloader.start();
