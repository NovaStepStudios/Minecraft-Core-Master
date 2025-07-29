```js
const ForgeInstaller = require('./loaders/forge/forge');

const minecraftPath = './.minecraft';
const forgeVersion = '1.16.5-36.2.20';

const installer = new ForgeInstaller(minecraftPath, forgeVersion);

installer.install().catch(console.error);
```