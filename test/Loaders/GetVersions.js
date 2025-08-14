const MinecraftLoaders = require('../../components/downloader/index.js');

// const Forge = new MinecraftLoaders().getVersions({type:'forge'}).on('data',(msg) =>{
//     console.log(msg);
// });
// const Fabric = new MinecraftLoaders().getVersions({type:'fabric'}).on('data',(msg) =>{
//     console.log(msg);
// });
// const Legacyfabric = new MinecraftLoaders().getVersions({type:'legacyfabric'}).on('data',(msg) =>{
//     console.log(msg);
// });
const Quilt = new MinecraftLoaders().getVersions({type:'quilt'}).on('data',(msg) =>{
    console.log(msg);
});

