import fs from 'fs';
import crypto from 'crypto';
import path from 'path';

const TOKEN_FILE = path.resolve(__dirname, 'ms_token.enc');
const SECRET_KEY = crypto.createHash('sha256').update('Minecraft-Core-Master SecretKey').digest(); // 32 bytes para AES-256
const IV_LENGTH = 16; // AES CBC IV length

export interface MicrosoftToken {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  obtained_at: number;
  client_token: string;
  uuid: string;
  name: string;
}

export class TokenManager {
    private token: MicrosoftToken | null = null;

    constructor() {
        this.loadToken();
    }

    // --- Cifrar ---
    private encrypt(data: string): string {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', SECRET_KEY, iv);
        const encrypted = Buffer.concat([cipher.update(data, 'utf8'), cipher.final()]).toString('hex');
        return iv.toString('hex') + ':' + encrypted;
    }

    // --- Descifrar ---
    private decrypt(data: string): string {
        const [ivHex, encryptedHex] = data.split(':');
        if (!ivHex || !encryptedHex) throw new Error('Token corrupto o inválido');
        const iv = Buffer.from(ivHex, 'hex');
        const encrypted = Buffer.from(encryptedHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', SECRET_KEY, iv);
        const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
        return decrypted;
    }

    // --- Guardar en archivo ---
    private saveToken() {
        if (!this.token) return;
        fs.writeFileSync(TOKEN_FILE, this.encrypt(JSON.stringify(this.token)), 'utf8');
    }

    // --- Cargar desde archivo ---
    private loadToken() {
        if (!fs.existsSync(TOKEN_FILE)) return;
        try {
        const encrypted = fs.readFileSync(TOKEN_FILE, 'utf8');
        this.token = JSON.parse(this.decrypt(encrypted));
        } catch (err) {
        console.error('No se pudo leer token:', err);
        this.token = null;
        }
    }

    // --- Login manual (guardar token luego de Microsoft login) ---
    public login(tokenData: MicrosoftToken) {
        this.token = tokenData;
        this.token.obtained_at = Math.floor(Date.now() / 1000);
        this.saveToken();
    }

    // --- Logout (eliminar token) ---
    public logout() {
        this.token = null;
        if (fs.existsSync(TOKEN_FILE)) fs.unlinkSync(TOKEN_FILE);
    }

    // --- Obtener token actual ---
    public getToken(): MicrosoftToken | null {
        if (!this.token) return null;

        // Verificar si expiro (10s de margen)
        const now = Math.floor(Date.now() / 1000);
        if (now > this.token.obtained_at + this.token.expires_in - 10) {
        console.warn('El token ha expirado, se debe refrescar.');
        return null;
        }

        return this.token;
    }

    // --- Actualizar token (refresh_token) ---
    public refresh(newTokenData: Partial<MicrosoftToken>) {
        if (!this.token) return;
        this.token = { ...this.token, ...newTokenData, obtained_at: Math.floor(Date.now() / 1000) };
        this.saveToken();
    }
}
