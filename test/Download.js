const MinecraftDownloader = require("../components/downloader/main");

const Download = new MinecraftDownloader();

Download.on("progress", ({ current, stepPercent, totalPercent }) => {
  console.log(`🔄 ${current}: ${stepPercent}% | Total: ${totalPercent}%`);
});

Download.on("step-done", name => {
  console.log(`✅ ${name} completado.`);
});

Download.on("done", () => {
  console.log("🎉 Todo listo para lanzar el juego!");
});

Download.on("error", err => {
  console.error("❌ Error:", err.message);
});

Download.downloadAll("./.minecraft", "1.20",false, true);
