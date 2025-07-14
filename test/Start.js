const MinecraftExecutor = require('../components/launch/index.js');

const Launcher = new MinecraftExecutor();

const opts = {
    root: './.minecraft',
    javaPath: 'C:/Program Files/Java/jre1.8.0_451/bin/javaw.exe'||'java',
    memory: {
        max: '6G',
        min: '1G',
    },
    version:{
        versionID: '1.12.2-forge-14.23.5.2860',
        type: 'release',
    },
    // window:{
    //     width: 768,
    //     height: 768,
    //     fullscreen: true
    // },
    client:{
        username: 'SantiagoStepnicka012',
        password: 'xxx_Santiago_xxx'
    },
    // jvmFlags:{}
    // mcFlags:{}
    demo: false, // || true
    debug: true, // || false
}

Launcher.start(opts);
Launcher.on('debug', console.log);
Launcher.on('error', console.error);

Launcher.on('ready', ({ args, opts }) => {
  const child = spawn(opts.javaPath, args, {
    stdio: 'inherit',
  });
  child.on('close', code => console.log(`Java cerrado con código ${code}`));
});