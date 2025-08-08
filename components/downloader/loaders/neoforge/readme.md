const path = require('path');
const NeoForgeInstaller = require('./neoforge');

(async () => {
    const minecraftDir = path.join(__dirname, 'Minecraft'); // Ruta a minecraft
    const neoForgeVersion = '21.4.0-beta'; // La versión de NeoForge que deseas instalar : URL (Versions) : https://maven.neoforged.net/releases/net/neoforged/neoforge/

    const installer = new NeoForgeInstaller(minecraftDir, neoForgeVersion);

    try {
        await installer.install();
        console.log("✅ NeoForge instalado correctamente.");
    } catch (err) {
        console.error("❌ Error durante la instalación:", err.message);
    }
})();
