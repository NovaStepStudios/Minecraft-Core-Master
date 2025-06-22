function platformName() {
  const p = process.platform;
  const arch = process.arch;
  if (p === "linux") {
    if (arch === "x64") return "linux-x86_64";
    if (arch === "arm64") return "linux-aarch_64";
    return "linux";
  }
  if (p === "win32") return "windows";
  if (p === "darwin") return "osx";
  return p;
}

module.exports = {
  platformName,
};
