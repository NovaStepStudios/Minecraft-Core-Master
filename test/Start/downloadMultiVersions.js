const { MinecraftDownloader } = require("../../dist/index");

async function main() {
    const downloader = new MinecraftDownloader();

    downloader.on("progress", ({ current, stepPercent, totalPercent }) => {
        console.log(`[PROGRESO] ${current} | Progreso: ${stepPercent}% | Total: ${totalPercent}%`);
        });

    downloader.on("step-done", (name) => {
        console.log(`[COMPLETADO] ${name}`);
    });

    downloader.on("warn", (msg) => {
        console.warn(`[ADVERTENCIA] ${msg}`);
    });

    downloader.on("error", (err) => {
        console.error(`[ERROR] ${err.message}`);
    });
    downloader.on("info", (msg) => {
        console.log(`[INFO] ${msg}`);
    });

    downloader.on("done", () => {
        console.log(`Descarga completa de todos los componentes de Minecraft!`);
    });

    // Iniciar descarga
    await Promise.all([
        downloader.start({ root: ".minecraft", version: "1.16.5", concurrency: 1, installJava: false, variantJava: "release" }),
        downloader.start({ root: ".minecraft", version: "1.21.4", concurrency: 1, installJava: false, variantJava: "release" }),
        downloader.start({ root: ".minecraft", version: "1.21.8", concurrency: 1, installJava: false, variantJava: "release" }),
    ]);
}

main().catch(console.error);
