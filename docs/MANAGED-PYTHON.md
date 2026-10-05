# Managed Python — ReferenceSync 1.0.2

Only the explicit Prepare engine button may download Python. Startup detection
never installs it, including through Windows Python Install Manager.

If an existing Python 3.10+ with pip is compatible, it is reused without changing
its installation. Otherwise a portable CPython 3.13.16 distribution from Astral's
immutable python-build-standalone 20261003 release is downloaded into
`~/.reference-sync/python`. No system installer, administrator rights, registry
changes, PATH edits, browser account or permanent background service is used.

## Supply chain and extraction

The three pinned archives and SHA-256 values are in js/python-builds.js.
macOS Intel and Apple Silicon have native builds. Windows x64 uses the x64 build;
Windows ARM64 uses that build under Windows 11 x64 emulation because the current
video dependency wheels lack native Windows ARM64 FFmpeg.

Downloads allow only HTTPS GitHub/objects/release-assets hosts, no credentials
or browser cookies, bounded sizes/timeouts and at most five checked redirects.
Electron net uses an isolated temporary partition with credentials omitted and
manual redirect checking; Node HTTPS is the fallback. Archive hashes are checked
before extraction or execution. Signed CDN addresses are not logged.

Extraction accepts bounded gzip/tar under python/, rejects traversal, aliases,
duplicates, invalid headers, special files and foreign links. Regular files are
written before safe in-root links. Windows file links avoid symlink privileges.
Archive scripts are not invoked. Private staging and atomic directory rename
prevent a partial installation from becoming the selected runtime.
The interpreter is checked before and after relocation, including SSL, SQLite,
ctypes, compression and pip. ensurepip, if necessary, runs only in this managed
Python, never in an existing system Python.

Subsequent pip preparation installs gallery-dl, yt-dlp with curl_cffi,
pycryptodomex for browser-cookie encryption and imageio-ffmpeg into the plugin
runtime. Dependency downloads use the configured package index, normally PyPI;
no pip download cache is added. Verification checks gallery version, AES,
native curl and FFmpeg before reporting ready. Startup leaves the setup button
available if a interrupted installation lacks required components.

Cancellation closes requests and child processes and removes unfinished
staging. Dead-process installation directories are cleaned on a later explicit
setup. Completed Python and download dependencies remain for reuse and are not
automatically deleted by plugin uninstall; remove them after closing the plugin
if no longer needed. An unrecognized existing installation folder is preserved
instead of blindly overwritten.

## Evidence, 2026-10-05

- 500 source unit tests, including downloader/hash/redirect/cancel, tar safety,
  Unix/Windows link handling, missing directory entries, reuse and retry.
- Actual pinned macOS ARM64 archive downloaded through Electron 22 and SHA-256
  verified; actual CPython installed and checked after relocation.
- Complete setup with all system interpreter probes denied in an isolated test:
  Python 3.13.16, gallery-dl 1.32.15, yt-dlp/curl_cffi/AES/FFmpeg ready.
  Neither the real Eagle library nor system Python was modified.
- Actual Windows x64 archive downloaded, verified and safely extracted; expected
  PE executable present. Native Windows ACL/execution and ARM64 emulation still
  require a Windows machine; these are not claimed live-tested.
- Exact packaged Eagle installation remains a separate release check.

Sources: [Astral release](https://github.com/astral-sh/python-build-standalone/releases/tag/20261003),
[portable distributions](https://docs.astral.sh/uv/concepts/python-versions/#managed-python-distributions),
[Eagle security criteria](https://developer.eagle.cool/plugin-api/plugin-review/criteria/security-and-privacy).
