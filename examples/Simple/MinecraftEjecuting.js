const { MinecraftExecutor } = require("../../index");
const executor = new MinecraftExecutor();

let opts = {
    root: './Minecraft',
    javaPath: 'java',
    memory:{
        max: '6G',
        min: '1G'
    },
    version: {
        versionID: '1.21.7',
        type: 'release',
    },
    window: {
        width: 1280,
        height: 720,
        fullscreen: false
    },
    jvm: [], // Opcional
    overrides: {}, // Opcional
    debug: true,
}

executor.start(opts);
