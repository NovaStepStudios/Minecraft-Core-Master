const {MinecraftExecutor} = require('../main.js');
const path = require('path');
const Launcher = new MinecraftExecutor();

const opts = {
  root: './.minecraft',
  javaPath: 'C:/Program Files/Java/jdk-17/bin/javaw.exe',
  memory: {
      max: '6G',
      min: '1G',
  },
  version:{
      versionID: '1.20.2',
      type: 'release',
  },
  // window:{
  //     width: 768,
  //     height: 768,
  //     fullscreen: true
  // },
  client:{
    username: 'SantiagoStepnicka012',
    password: 'SantiagoStepnicka',
  },
  // jvmFlags:{}
  // mcFlags:{}
  demo: false, // || true
  debug: true, // || false
}

Launcher.start(opts);
Launcher.on('debug', console.log);
Launcher.on('error', console.error);