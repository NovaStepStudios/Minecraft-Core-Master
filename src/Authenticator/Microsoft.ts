import { Buffer } from 'node:buffer';
import crypto from 'crypto';
import { TokenManager, MicrosoftToken } from './Token';

export type MicrosoftClientType = 'electron' | 'nwts' | 'terminal';

export interface MinecraftSkin {
    id?: string;
    state?: string;
    url?: string;
    variant?: string;
    alias?: string;
    base64?: string;
}

export interface MinecraftProfile {
    id: string;
    name: string;
    skins: MinecraftSkin[];
    capes: MinecraftSkin[];
}

export interface AuthError {
    error: string;
    errorType?: string;
    [key: string]: any;
}

export interface AuthResponse {
    access_token: string;
    client_token: string;
    uuid: string;
    name: string;
    refresh_token: string;
    user_properties: string;
    meta: {
        type: 'Xbox';
        access_token_expires_in: number;
        demo: boolean;
    };
    xboxAccount: {
        xuid: string;
        gamertag: string;
        ageGroup: string;
    };
    profile: MinecraftProfile;
}

interface OAuth2Response {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    [key: string]: any;
}

// --- Convertir imagen a base64
async function getBase64(url: string): Promise<string> {
    const res = await fetch(url);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer).toString('base64');
}

export default class Microsoft {
    public client_id: string;
    public type: MicrosoftClientType;
    private tokenManager: TokenManager;

    constructor(client_id?: string) {
        this.client_id = client_id || '00000000402b5328';
        this.tokenManager = new TokenManager();

        if (typeof process !== 'undefined' && process.versions?.electron) this.type = 'electron';
        else if (typeof process !== 'undefined' && process.versions?.nw) this.type = 'nwts';
        else this.type = 'terminal';
    }

    /** Login manual */
    public async getAuth(type?: MicrosoftClientType, url?: string): Promise<AuthResponse | AuthError | false> {
        const finalType = type || this.type;
        const finalUrl =
            url || `https://login.live.com/oauth20_authorize.srf?client_id=${this.client_id}&response_type=code&redirect_uri=https://login.live.com/oauth20_desktop.srf&scope=XboxLive.signin%20offline_access&cobrandid=8058f65d-ce06-4c30-9559-473c9275a65d&prompt=select_account`;

        let userCode: string = 'cancel';

        switch (finalType) {
            case 'electron': {
                const module = await import('./UI/Electron');
                userCode = (await module.default(finalUrl)) ?? 'cancel';
                if (userCode === 'cancel') return false;
                return this.exchangeCodeForToken(userCode);
                break;
            }
            case 'nwts': {
                const module = await import('./UI/NW');
                userCode = (await module.default(finalUrl)) ?? 'cancel';
                break;
            }
            case 'terminal': {
                const module = await import('./UI/Terminal');
                userCode = (await module.default(finalUrl)) ?? 'cancel';
                break;
            }
            default:
                return false;
        }

        if (userCode === 'cancel') return false;

        return this.exchangeCodeForToken(userCode);
    }

    /** Auto login usando token guardado */
    public async autoLogin(): Promise<AuthResponse | AuthError | false> {
        const token = this.tokenManager.getToken();
        if (!token) return this.getAuth();

        const profile = await this.getProfile({ access_token: token.access_token });
        if ('error' in profile) return this.getAuth();

        return {
            access_token: token.access_token,
            client_token: token.client_token,
            uuid: token.uuid,
            name: token.name,
            refresh_token: token.refresh_token,
            user_properties: '{}',
            meta: { type: 'Xbox', access_token_expires_in: token.obtained_at + token.expires_in, demo: false },
            xboxAccount: { xuid: token.uuid, gamertag: token.name, ageGroup: 'UNKNOWN' },
            profile
        };
    }

    /** Logout */
    public logout() {
        this.tokenManager.logout();
    }

    /** Obtener perfil de Minecraft */
    public async getProfile(mcLogin: { access_token: string }): Promise<MinecraftProfile | AuthError> {
        try {
            const res = await fetch('https://api.minecraftservices.com/minecraft/profile', {
                headers: { Authorization: `Bearer ${mcLogin.access_token}` }
            });

            // Primero tomamos como any
            const data: any = await res.json();

            if (data.error) return { error: data.error };

            // Validar existencia de campos esenciales
            if (!data.id || !data.name) {
                return { error: 'Perfil inválido o incompleto' };
            }

            const skins: MinecraftSkin[] = Array.isArray(data.skins) ? data.skins : [];
            const capes: MinecraftSkin[] = Array.isArray(data.capes) ? data.capes : [];

            for (const s of skins) if (s.url) s.base64 = `data:image/png;base64,${await getBase64(s.url)}`;
            for (const c of capes) if (c.url) c.base64 = `data:image/png;base64,${await getBase64(c.url)}`;

            // Retornamos con tipado correcto
            const profile: MinecraftProfile = {
                id: data.id,
                name: data.name,
                skins,
                capes
            };

            return profile;
        } catch (err: any) {
            return { error: err.message };
        }
    }

    /** Intercambiar código de autorización por token y obtener Minecraft token real */
    private async exchangeCodeForToken(code: string): Promise<AuthResponse | AuthError> {
        try {
            const res = await fetch('https://login.live.com/oauth20_token.srf', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: `client_id=${this.client_id}&code=${code}&grant_type=authorization_code&redirect_uri=https://login.live.com/oauth20_desktop.srf`
            });
            const oauth2 = await res.json() as OAuth2Response;
            if ('error' in oauth2) return { error: oauth2.error, errorType: 'oauth2', ...oauth2 };

            return this.getMinecraftAccount(oauth2);
        } catch (err: any) {
            return { error: err.message, errorType: 'network' };
        }
    }

    /** Flujo completo para obtener Minecraft token real y perfil */
    private async getMinecraftAccount(oauth2: OAuth2Response): Promise<AuthResponse | AuthError> {
        try {
            // 1️⃣ Xbox Live Authentication
            const xbl = await this.fetchJSON('https://user.auth.xboxlive.com/user/authenticate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({
                    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${oauth2.access_token}` },
                    RelyingParty: 'http://auth.xboxlive.com',
                    TokenType: 'JWT'
                })
            });
            if (xbl.error) return { ...xbl, errorType: 'xbl' };

            // 2️⃣ XSTS Authorization
            const xsts = await this.fetchJSON('https://xsts.auth.xboxlive.com/xsts/authorize', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
                    RelyingParty: 'rp://api.minecraftservices.com/',
                    TokenType: 'JWT'
                })
            });
            if (xsts.error) return { ...xsts, errorType: 'xsts' };

            // 3️⃣ Minecraft login
            const mcLogin = await this.fetchJSON('https://api.minecraftservices.com/authentication/login_with_xbox', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ identityToken: `XBL3.0 x=${xbl.DisplayClaims.xui[0].uhs};${xsts.Token}` })
            });
            if (mcLogin.error) return { ...mcLogin, errorType: 'mcLogin' };

            // 4️⃣ Perfil de Minecraft
            const profile = await this.getProfile({ access_token: mcLogin.access_token });
            if ('error' in profile) return { ...profile, errorType: 'profile' };

            // 5️⃣ Guardar token en TokenManager
            const now = Math.floor(Date.now() / 1000);
            const token: MicrosoftToken = {
                access_token: mcLogin.access_token,
                refresh_token: oauth2.refresh_token,
                expires_in: mcLogin.expires_in,
                obtained_at: now,
                client_token: crypto.randomBytes(16).toString('hex'),
                uuid: profile.id,
                name: profile.name
            };
            this.tokenManager.login(token);

            return {
                access_token: mcLogin.access_token,
                client_token: token.client_token,
                uuid: profile.id,
                name: profile.name,
                refresh_token: oauth2.refresh_token,
                user_properties: '{}',
                meta: { type: 'Xbox', access_token_expires_in: now + mcLogin.expires_in, demo: false },
                xboxAccount: {
                    xuid: xbl.DisplayClaims.xui[0].xid,
                    gamertag: xbl.DisplayClaims.xui[0].gtg,
                    ageGroup: xbl.DisplayClaims.xui[0].agg
                },
                profile
            };
        } catch (err: any) {
            return { error: err.message, errorType: 'network' };
        }
    }

    /** Helper fetch + parse JSON */
    private async fetchJSON(url: string, options: any): Promise<any> {
        try {
            const res = await fetch(url, options);
            return await res.json();
        } catch (err: any) {
            return { error: err.message };
        }
    }
}
