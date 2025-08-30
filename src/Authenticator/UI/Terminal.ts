import prompt from "prompt";
export default async function getCodeFromTerminal(url: string): Promise<string | null> {
    console.log(`Open browser: ${url}`);
    prompt.start();
    const result: Record<'copy-URL', string> = await prompt.get(['copy-URL']) as any;
    const codeUrl = result['copy-URL'];
    if (!codeUrl) return null;
    const codeMatch = codeUrl.split("code=")[1]?.split("&")[0];
    return codeMatch || null;
}
