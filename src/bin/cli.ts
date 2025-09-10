#!/usr/bin/env node
import { MinecraftDownloader, MinecraftLauncher } from "../index";

const args = process.argv.slice(2);
const command = args[0];

async function download(version: string, dir: string, concurrency: number = 1) {
  const Downloader = new MinecraftDownloader();
  try {
    Downloader.on('progress', (msg) => console.log("[ PROGRESS ]",msg));
    Downloader.on('step-done', (msg) => console.log('[ DEBUG ]', msg));
    Downloader.on('warn', (msg) => console.warn('[ WARN ]', msg));
    Downloader.on('error', (err) => console.error('[ ERROR ]', err));
    Downloader.on('info', (msg) => console.log("[ INFO ]",msg));
    Downloader.on('done', (msg) => console.log("[ DONE ]",msg));
    await Downloader.start({
      root: dir,
      version,
      concurrency,
      installJava: false
    }).finally(()=>{
      console.log(`Minecraft Se a Descargado Exitosamente : Dir. ${dir}, Vers. ${version}`)
      process.exit(0)
    });
  } catch (err) {
    console.error("Error descargando Minecraft:", err);
    console.timeEnd("Tiempo De Descarga En Todal :")
  }
}

async function launch(version: string, dir: string, debug: boolean = false, memoryMax: string = "2G", memoryMin: string = "512M") {
  try {
    // Logueo rápido con usuario dummy (puedes extender a pedir credenciales)
    // const user = await Mojang.login("Player");

    const launcher = new MinecraftLauncher({
      version,
      root: dir,
      debug,
      memory: { min: memoryMin, max: memoryMax },
      authenticator: {
        name: "Player",
        meta: {
          type: "mojang",
        },
      },
    });

    // Eventos para logging
    launcher.on('debug', (msg) => console.log('[DEBUG]', msg));
    launcher.on('warn', (msg) => console.warn('[WARN]', msg));
    launcher.on('error', (err) => console.error('[ERROR]', err));
    launcher.on('data', (msg) => console.log(msg));

    await launcher.launch();
  } catch (err) {
    console.error("Falló el lanzamiento:", err);
  }
}

// ---------------------------
// Comandos
// ---------------------------
switch (command) {
  case "download":
    download(args[1] || "1.12.2", args[2] || ".minecraft", args[3] ? Number(args[3]) : 1);
    break;

  case "launch":
    launch(
      args[1] || "1.12.2", // version
      args[2] || ".minecraft", // dir
      args[3] === "false",     // debug
      args[4] || "2G",        // memoryMax
      args[5] || "512M"       // memoryMin
    );
    break;

  default:
    console.log(`Comandos disponibles:
                  download <version> <dir> [concurrency]
                  launch <version> <dir> [debug] [memoryMax] [memoryMin]`);
}
