```js
const LegacyFabricInstaller = require('./loaders/legacyfabric/legacyfabric');

const mcPath = './.minecraft';
const legacyFabricVer = '1.8.9'; // Ver en https://meta.legacyfabric.net/v3/versions/installer

const installer = new LegacyFabricInstaller(mcPath, legacyFabricVer);
installer.install().catch(console.error);
```