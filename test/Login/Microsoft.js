const {Microsoft} = require("../../dist/index");

async function main() {
    const ms = new Microsoft();

    console.log("Iniciando login con Microsoft...");

    // Intentamos login ( va a abrir la UI según el tipo: electron, terminal, nwts )
    const auth = await ms.getAuth("electron");

    if (!auth || "error" in auth) {
        console.error("❌ Error al autenticar:", auth);
        return;
    }

    console.log("✅ Login correcto!");
    console.log("Access Token:", auth.access_token.substring(0, 20) + "..."); // recortado
    console.log("Gamertag:", auth.xboxAccount.gamertag);
    console.log("UUID:", auth.uuid);
    console.log("Nombre:", auth.name);

    console.log("\n Perfil de Minecraft:");
    console.log("ID:", auth.profile.id);
    console.log("Nombre:", auth.profile.name);

    if (auth.profile.skins.length > 0) {
        console.log("Skins:", auth.profile.skins.map(s => s.url));
    } else {
        console.log("Sin skins 😢");
    }

    if (auth.profile.capes.length > 0) {
        console.log("Capes:", auth.profile.capes.map(c => c.url));
    } else {
        console.log("Sin capas 🦸");
    }
}

main().catch(err => console.error("💥 Error fatal:", err));
