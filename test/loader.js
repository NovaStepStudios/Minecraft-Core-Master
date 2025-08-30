const { LoaderInstaller } = require('../dist/index');

const loaderInstaller = new LoaderInstaller();


loaderInstaller.on('speed', (msg) => console.log('[DEBUG]', msg));
loaderInstaller.on('progress', (msg) => console.log('[PROGRESS]', msg));
loaderInstaller.on('warn', (msg) => console.warn('[WARN]', msg));
loaderInstaller.on('error', (err) => console.error('[ERROR]', err));

loaderInstaller.start({
    root: "./.minecraft",
    loader: {
        type: "fabric",
        build: "0.17.2",
        version: "1.16.5",
        // outputDir: "./cache/loaders",
    },
    // meta: {
    //     installer : "https://maven.minecraftforge.net/net/minecraftforge/forge/${version}/forge-${version}-installer.jar"
    // }
});
