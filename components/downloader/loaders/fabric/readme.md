```js
const FabricInstaller = require('./loaders/fabric/fabric');

const mcPath = './.minecraft';
const FabricVer = '1.14.2';

const installer = new FabricInstaller(mcPath, FabricVer);
installer.install().catch(console.error);

```