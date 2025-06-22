const path = require("path");
const fs = require("fs/promises");
const crypto = require("crypto");
const https = require("https");

class UserManager {
  constructor(root) {
    this.root = root;
    this.profilesPath = path.join(root, "launcher_profiles.json");
    this.skinsDir = path.join(root, "skins");
  }

  async resolve(user) {
    if (user?.uuid && user?.accessToken) return user;

    let profiles = [];
    try {
      const raw = await fs.readFile(this.profilesPath, "utf-8");
      profiles = JSON.parse(raw);
    } catch {
      profiles = [];
    }

    // Si hay una cuenta válida ya guardada, usarla
    const existing = profiles.find(p => p.uuid && p.accessToken && p.type === "legacy");
    if (existing) return existing;

    // Generar cuenta local
    const newUser = {
      type: "legacy",
      name: "Player",
      uuid: crypto.randomUUID(),
      accessToken: crypto.randomBytes(32).toString("hex"),
    };

    profiles.push(newUser);
    await fs.writeFile(this.profilesPath, JSON.stringify(profiles, null, 2));
    return newUser;
  }

  /**
   * Intenta logear con una cuenta de Mojang clásica (legacy)
   * @param {string} email 
   * @param {string} password 
   */
  async loginMojang(email, password) {
    const payload = JSON.stringify({
      agent: { name: "Minecraft", version: 1 },
      username: email,
      password: password,
      requestUser: true
    });

    const options = {
      hostname: "authserver.mojang.com",
      path: "/authenticate",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload)
      }
    };

    const response = await new Promise((resolve, reject) => {
      const req = https.request(options, res => {
        let data = "";
        res.on("data", chunk => data += chunk);
        res.on("end", () => {
          if (res.statusCode === 200) resolve(JSON.parse(data));
          else reject(new Error(`Error de autenticación Mojang: ${res.statusCode}`));
        });
      });

      req.on("error", reject);
      req.write(payload);
      req.end();
    });

    const userProfile = {
      type: "mojang",
      name: response.selectedProfile.name,
      uuid: response.selectedProfile.id,
      accessToken: response.accessToken
    };

    let profiles = [];
    try {
      const raw = await fs.readFile(this.profilesPath, "utf-8");
      profiles = JSON.parse(raw);
    } catch {}

    profiles.push(userProfile);
    await fs.writeFile(this.profilesPath, JSON.stringify(profiles, null, 2));

    return userProfile;
  }

  /**
   * Devuelve la ruta del skin local si existe
   * @param {string} uuid 
   */
  async getSkin(uuid) {
    const file = path.join(this.skinsDir, `${uuid}_skin.png`);
    try {
      await fs.access(file);
      return file;
    } catch {
      return null;
    }
  }

  /**
   * Devuelve la ruta de la capa local si existe
   * @param {string} uuid 
   */
  async getCape(uuid) {
    const file = path.join(this.skinsDir, `${uuid}_cape.png`);
    try {
      await fs.access(file);
      return file;
    } catch {
      return null;
    }
  }
}

module.exports = { UserManager };
