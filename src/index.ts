/**
 * @author NovaStepStudios
 * @alias StepnickaSantiago
 * @license Apache-2.0
 * @link https://www.apache.org/licenses/LICENSE-2.0
 */
import { MinecraftDownloader } from "./download";
import { MinecraftLauncher } from "./launch";
// import { LoaderInstaller } from "./Minecraft-Loaders/index"
import { Microsoft, Mojang, AZauth } from "./Authenticator/index"
export {
    MinecraftDownloader as MinecraftDownloader,
    MinecraftLauncher as MinecraftLauncher,
    // LoaderInstaller as LoaderInstaller,
    Microsoft as Microsoft,
    AZauth as AZauth,
    Mojang as Mojang
}