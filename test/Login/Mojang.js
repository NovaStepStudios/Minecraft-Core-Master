const { Mojang } = require('../../dist/index');

async function MojangLogin() {
    try {
        const msg = await Mojang.login("Stepnicka012");
        console.log(msg);
    } catch (err) {
        console.error(err);
    }
}
MojangLogin();