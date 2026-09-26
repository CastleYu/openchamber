const binary = (platform) => platform === 'win32' ? 'opencode.exe' : 'opencode';

export const artifactForPlatform = (version, platform, targetArchitecture) => {
  const arch = targetArchitecture.opencode;
  if (!['x64', 'arm64'].includes(arch)) throw new Error(`No OpenCode CLI artifact mapping for ${platform}/${arch}`);
  if (!['darwin', 'win32', 'linux'].includes(platform)) throw new Error(`No OpenCode CLI artifact mapping for ${platform}/${arch}`);
  const major = Number(version.split('.')[0]);
  if (major === 1) {
    // OC1 Windows ARM64 has a Bun FFI/TinyCC startup failure; keep the
    // existing x64-baseline binary under Windows emulation for that release.
    const assetArch = platform === 'win32' && arch === 'arm64' ? 'x64' : arch;
    const target = platform === 'win32' ? 'windows' : platform;
    const suffix = assetArch === 'x64' ? '-baseline' : '';
    const extension = platform === 'linux' ? '.tar.gz' : '.zip';
    const name = `opencode-${target}-${assetArch}${suffix}${extension}`;
    return { kind: 'github', name, binary: binary(platform), url: `https://github.com/anomalyco/opencode/releases/download/v${version}/${name}` };
  }
  if (major === 2) {
    const target = `${platform === 'win32' ? 'windows' : platform}-${arch}${arch === 'x64' ? '-baseline' : ''}`;
    const name = `cli-${target}-${version}.tgz`;
    return { kind: 'npm', name, binary: binary(platform), url: `https://registry.npmjs.org/@opencode/cli-${target}/-/cli-${target}-${version}.tgz` };
  }
  throw new Error(`Unsupported OpenCode CLI major version: ${version}`);
};
