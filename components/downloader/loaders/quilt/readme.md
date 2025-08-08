```js
const QuiltInstaller = require('./loaders/quilt/quilt');

const mcPath = './.minecraft';
const QuiltVer = '1.20';

const installer = new QuiltInstaller(mcPath, QuiltVer);
installer.install().catch(console.error);
```