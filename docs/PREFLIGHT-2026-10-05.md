# ReferenceSync 1.0.2 — moderation preflight, 2026-10-05

M12-T13 adds explicit one-button setup; the 1.0.1 Python-preinstallation wording
is superseded. With no compatible Python+pip, the button installs a separate
pinned portable CPython, then required download/video/AES components. No system
Python, PATH or registry modifications. See MANAGED-PYTHON.md for detailed
supply-chain, permissions, archive, cancellation and retention behavior.

Evidence: 500/500 Node tests, 45/45 browser tests, actual macOS ARM64 archive and
complete preparation in an isolated Electron 22 test with all system Python
probes denied. Repeat reused the private Python without a second Python download.
Actual Windows archive HTTPS/SHA-256/extraction/PE layout also verified. Native
Windows execution/ACL and ARM64 x64-emulation checks are still pending.

Cookie safeguards and authenticated archive HTTPS remain enabled and tested.
Three available sources are adjacent. No store/Figma assets were edited.
Current EN/ZH listing copy accurately describes implemented automatic setup;
replace the live draft fields and both covers before resubmission.

Source/runtime tests do not replace installing the exact Eagle-generated
.eagleplugin on supported OS/builds after moving/downloading it. A clean project
folder is provided separately; no Python binaries, downloaded media, credentials,
Git, test files or dependency caches are included in the plugin package.

[Security criteria](https://developer.eagle.cool/plugin-api/plugin-review/criteria/security-and-privacy)
[Final package preparation](https://developer.eagle.cool/plugin-api/publishing/prepare)
