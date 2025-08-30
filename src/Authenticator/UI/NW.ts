import path from "path";

// --- Propiedades de la ventana ---
const defaultProperties: any = {
    width: 1000,
    height: 650,
    resizable: false,
    position: "center",
    frame: true,
    icon: path.join(__dirname, "../../../resources/icons/microsoft.png")
};

// --- Declaramos `nw` globalmente ---
declare global {
    const nw: any;
}

interface Cookie {
    name: string;
    domain: string;
    path: string;
    secure: boolean;
}

export = async function(url: string): Promise<string> {
    // --- Limpiar cookies ---
    await new Promise<void>((resolve) => {
        nw.Window.get().cookies.getAll({ domain: "live.com" }, (cookies: Cookie[]) => {
            for (const cookie of cookies) {
                const cookieUrl = `http${cookie.secure ? "s" : ""}://${cookie.domain.replace(/^\./, "") + cookie.path}`;
                nw.Window.get().cookies.remove({ url: cookieUrl, name: cookie.name });
            }
            resolve();
        });
    });

    // --- Abrir ventana y capturar el código ---
    const code: string = await new Promise<string>((resolve) => {
        nw.Window.open(url, defaultProperties, (Window: any) => {
            let intervalId: number | undefined;
            let authCode: string | null = null;

            intervalId = Window.window.setInterval(() => {
                try {
                    const href = Window.window.document.location.href;
                    if (href.startsWith("https://login.live.com/oauth20_desktop.srf")) {
                        if (intervalId !== undefined) Window.window.clearInterval(intervalId);
                        authCode = href.split("code=")[1]?.split("&")[0] || "cancel";
                        Window.close();
                    }
                } catch {
                    authCode = "cancel";
                }
            }, 100);

            Window.on("closed", () => {
                if (!authCode) authCode = "cancel";
                if (intervalId !== undefined) Window.window.clearInterval(intervalId);
                resolve(authCode);
            });
        });
    });

    return code;
};
