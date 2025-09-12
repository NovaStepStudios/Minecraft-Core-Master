const { FabricInstallerDownloader } = require('../../dist/Minecraft-Loaders/Fabric/Fabric');

(async () => {
  const downloader = new FabricInstallerDownloader({
    root: '.MiCarpetaFabric',
    gameVersion: '1.20.1', // Version de Minecraft Para Build
    loaderVersion: '0.17.2', // Version de Loader/Build
    });

  const interval = setInterval(() => {
    console.log(`Progress: ${downloader.Progress}%`);
    if (downloader.Progress >= 100) clearInterval(interval);
  }, 500);

  const result = await downloader.downloadInstaller();
  console.log('Fabric loader descargado en:', result.path);
  console.log('SHA1:', result.hash);
})();
