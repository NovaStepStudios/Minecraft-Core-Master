const { VersionHandler } = require("../dist/Minecraft/Handler/Version");
const { ArgumentBuilder } = require("../dist/Minecraft/Handler/Arguments");
const { ClasspathManager } = require("../dist/Minecraft/Handler/Classpath");
const { Mojang } = require("../dist/index");
const { spawn } = require("child_process");
const ROOT = ".minecraft";
const VERSION_ID = "1.16.5";
const JAVA_PATH = "C:/Program Files/Java/jdk-19/bin/javaw.exe";

(async () => {
  try {
    const user = await Mojang.login("Stepnicka012");
    console.log("Usuario logueado:", user);

    const versionHandler = new VersionHandler(ROOT);
    const version = versionHandler.loadVersion(VERSION_ID);
    console.log("Versión cargada:", version.id);

    // const libDownloader = new LibrariesManager(ROOT, version);
    // await libDownloader.downloadAll();

    const classpathManager = new ClasspathManager(ROOT, version);
    const { classpath, nativesDir } = classpathManager.buildClasspath();
    console.log("Classpath listo:", classpath);
    console.log("Nativos listos en:", nativesDir);

    const args = ArgumentBuilder.build({
      opts: {
        root: ROOT,
        memory: { min: "1G", max: "4G" },
        // window: { width: 1280, height: 720 },
        debug: false,
      },
      version,
      auth: {
        name: user.name,
        uuid: user.uuid,
        accessToken: user.access_token,
        provider: user.meta?.type ?? "mojang",
        userProperties: { value: user.user_properties },
        clientId: user.client_token,
        offline: false,
      },
      classPath: classpath,
    });

    console.log("Argumentos finales:", args);

    const child = spawn(JAVA_PATH, args, {
      cwd: ROOT,
      detached: false,
      stdio: "inherit",
    });

    child.on("close", (code) => {
      console.log(`Minecraft salió con código ${code}`);
    });

  } catch (err) {
    console.error("Error ejecutando Minecraft:", err);
  }
})();
