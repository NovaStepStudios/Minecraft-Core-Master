const prompt = require('prompt')
const { NovaAZauth, MinecraftLauncher } = require('../../dist/index');
const auth = new NovaAZauth('https://nincraft.fr');
const fs = require('fs');

let mc
async function login() {
    console.log('Inserte tu Email');
    prompt.start();
    let { email } = await prompt.get(['email']);
    console.log('Inserta tu Contrseña');
    let { password } = await prompt.get(['password']);
    let azauth = await auth.login(email, password);

    if (azauth.A2F) {
        console.log('Esperando codigo...');
        let { code } = await prompt.get(['code']);
        azauth = await auth.login(email, password, code);
    }

    if (azauth.error) {
        console.log(azauth);
        process.exit(1);
    }
    return azauth;
}

async function main() {
    if (!fs.existsSync('./NovaAZauth.json')) {
        mc = await login();
        fs.writeFileSync('./NovaAZauth.json', JSON.stringify(mc, null, 4));
    } else {
        mc = JSON.parse(fs.readFileSync('./NovaAZauth.json'));

        if (!mc.access_token) {
            mc = await login();
            fs.writeFileSync('./NovaAZauth.json', JSON.stringify(mc, null, 4));
        } else {
            mc = await auth.verify(mc);
            if (mc.error) mc = await login();
            fs.writeFileSync('./NovaAZauth.json', JSON.stringify(mc, null, 4));
        }
    }

    let opt = {
        version: '1.21.8-OptiFine_HD_U_J6_pre16',
        root: './.minecraft',
        javaPath: "C:/Program Files/Java/jdk-24/bin/javaw.exe",
        jvmArgs: [], // Argumentos de JVM *Java* [ Opcional ]
        mcArgs:[], // Argumentos de Minecraft [ Opcional ]
        debug: true, // Modo Deubg [ Opcional ]
        memory:{
            min: "512M",
            max: "4G"
        },
        authenticator: {
            ...mc,
            name: mc.name.slice(0,16) // Limitar Nombre a 16 Caracteres
        },
        window: {
            width: null,
            height: null,
            fullscreen: false
        }
    }

    const launcher = new MinecraftLauncher(opt);
    try{
        await launcher.launch();
    } catch (err){
        console.log("Fallo el lanzamiento de Minecraft :",err)
    }

    launcher.on('debug', (msg) => console.log('[DEBUG]', msg));
    launcher.on('warn', (msg) => console.warn('[WARN]', msg));
    launcher.on('error', (err) => console.error('[ERROR]', err));
    launcher.on('data', (msg) => console.log(msg));
}

main()