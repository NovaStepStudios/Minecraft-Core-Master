const { MinecraftEjecuting } = require("../index");
const LaunchMC = new MinecraftEjecuting();

let opts = {
  root: "./Minecraft", // Ruta del juego
  javaPath: "java", // Ruta del java || javaw
  memory: {
    max: "6G", // ( Default : 4GB )
    min: "1G", // ( Default : 1GB )
  }, // Minima y maxima ram
  window: {
    height: "480", // Por default
    width: "854", // Por default
    fullscreen: false, // Fullscreen true || false
  }, // Tamaño de la ventana ( Opcional )
  version: {
    versionID: "1.8.9", // Version a ejecutar ( Si no ay version, tira error )
    type: "release", // Tipo de version [ forge - optifine - release - snapshot - neoforge - fabric ]
  },
  user: {
    name: "xxx_MataAbuelitas3000_xxx", // ( Opcional eligira automaticamente el nombre )
    skinPath: "./skin.png", // ( Opcional ) EN TESTEO
    capaPath: "./cape.png", // ( Opcional ) EN TESTEO
  },
};

LaunchMC.launch(opts);

LaunchMC.on("debug", (e) => console.log(e)); // Como se ejecuta el juego
LaunchMC.on("data", (e) => console.log(e)); // Data extra