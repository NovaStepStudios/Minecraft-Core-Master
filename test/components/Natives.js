const MinecraftNativesDownloader = require("../../components/downloader/Minecraft/Minecraft-Natives");

const downloader = new MinecraftNativesDownloader("./.minecraft", "1.20.4");

downloader.on("progress", (p) => console.log(`[${p.current}/${p.total}] Descargado - ${p.percent}%`));
downloader.on("done", () => console.log("✅ Nativos descargados y extraídos"));
downloader.on("error", e => console.error("❌ Error:", e));

downloader.start();
