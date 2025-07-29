const MinecraftLibrariesDownloader = require("../../components/downloader/Minecraft/Minecraft-Libraries");

const downloader = new MinecraftLibrariesDownloader("./.minecraft", "1.20.4");
downloader.on("progress", ({ current, total, percent }) => {
  console.log(`[${current}/${total}] Descargado - ${percent}%`);
});
downloader.on("done", () => console.log("✅ Librerías descargadas correctamente."));
downloader.on("error", console.error);
downloader.start();
