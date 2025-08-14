const { MinecraftLoaders } = require('../../main.js');

const installer = MinecraftLoaders.neoforge({
    root: '.minecraft', // Ruta a la carpeta raíz
    version: '21.4.0-beta' // Versión de NeoForge
});

installer.on('data', (msg) => {
    console.log(`[NeoForge] ${msg}`);
});

installer.on('done', () => {
    console.log("✅ NeoForge instalado correctamente.");
});

installer.on('error', (err) => {
    console.error("❌ Error durante la instalación:", err);
});

// Link https://maven.neoforged.net/releases/net/neoforged/neoforge/