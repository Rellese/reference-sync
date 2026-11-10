// Pinned immutable Astral release. SHA-256 from release assets and uv metadata.
// https://github.com/astral-sh/python-build-standalone/releases/tag/20261003
export const PYTHON_VERSION='3.13.16';
export const PYTHON_BUILD='20261003';
export const PYTHON_BUILDS=Object.freeze({
  "darwin-arm64": {
    "url": "https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-aarch64-apple-darwin-install_only_stripped.tar.gz",
    "sha256": "9e01f63bbb08576cd9c8bc2d0564d098cb30c8453a0cd4bcf6aef458f6d2a147",
    "bytes": 25246115
  },
  "darwin-x64": {
    "url": "https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-x86_64-apple-darwin-install_only_stripped.tar.gz",
    "sha256": "b4dad38ba6a344555ccb71a1b08caad0a6c0dda88c5803658bc95bd7f04e9f5c",
    "bytes": 24964084
  },
  "win32-x64": {
    "url": "https://github.com/astral-sh/python-build-standalone/releases/download/20261003/cpython-3.13.16%2B20261003-x86_64-pc-windows-msvc-install_only_stripped.tar.gz",
    "sha256": "ec43f1a85c29f147d7ae2d13218c52c70b24a983a82ab22d6c607c0593060e10",
    "bytes": 21970131
  }
});
export function pythonBuild(platform=process.platform,arch=process.arch) {
  // Current video wheels lack native Windows ARM64 FFmpeg. Use Windows 11 x64
  // emulation so the same one-button flow can install all video components.
  const runtimeArch=platform==='win32'&&arch==='arm64'?'x64':arch;
  const value=PYTHON_BUILDS[platform+'-'+runtimeArch];
  if(!value)throw Error('PYTHON_PLATFORM');
  return {...value,version:PYTHON_VERSION,runtimeArch,usesX64Emulation:runtimeArch!==arch,
    key:'cpython-'+PYTHON_VERSION+'-'+PYTHON_BUILD+'-'+platform+'-'+arch,
    executable:platform==='win32'?'python/python.exe':'python/bin/python3.13'};
}
