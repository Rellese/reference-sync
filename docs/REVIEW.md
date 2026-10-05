# Review notes — ReferenceSync 1.0.2

Window plugin with explicit one-button preparation. No manual Python installation
is required on supported macOS/Windows systems. Startup never downloads Python.

The button reuses a compatible existing Python 3.10+ with pip; otherwise installs
a separate pinned portable CPython from Astral GitHub. Hash verification precedes
execution, extraction is bounded and path-checked, and installation is committed
by rename. Python, download tools and video dependencies stay in the user's
ReferenceSync working directories; system Python/PATH/registry are not modified.
Windows ARM64 uses x64 emulation and requires Windows 11. Read MANAGED-PYTHON.md
for versions, source, redirects, permissions, cancellation and retention.
No interpreter or executable archive is bundled in this .eagleplugin.

## Reproduce setup and main flow

1. Install the actual Eagle-generated package in a disposable library, without
   the source checkout. Open ReferenceSync: detection must not install anything.
2. With no suitable Python, click Prepare engine. Verify progress, independent
   Python, gallery-dl and video components, then ready. No terminal/admin needed.
3. Close during download/extraction/dependency install; reopen and retry. A
   partial gallery-dl-only runtime must not be reported fully ready.
4. With existing compatible Python+pip, prepare without replacing system Python.
   Without pip or on incompatible Windows ARM64 Python, use the separate runtime.
5. Instagram/Pinterest: review account and profile, saved collections, single
   media/carousel, import, repeat without duplicates, all three search modes.
6. Behance: moodboards or project link, three modes, whole .rscase plus blocks;
   separate ReferenceCanvas is needed to view .rscase, not installed by Sync.
7. Synthetic archive HTTP links become verified-platform canonical HTTPS before
   browser-authenticated download; off-host/userinfo/port links must reject.
8. Test permissions, stop/recovery and cleanup on Windows and macOS. Supply
   dedicated account credentials only through private review fields, not code.

## Data and authentication

Eagle SDK preferred, localhost:41595 fallback disclosed. Browser-authenticated
Instagram/Pinterest/Behance flows share protected cookie snapshots: directory and
file permissions before writing, reserved exporter .tmp, verification after
export, finally/exit/dead-process cleanup. Windows ACL still needs a real native
browser export test. Interrupted snapshots may remain until a later cleanup.

Behance Vimeo recovery uses a temporary isolated player without browser cookies,
Node or Eagle API access, then validated Vimeo CDN HTTPS downloads. Signed stream
snapshots are private, excluded from arguments/logs/case archives and removed.
Settings/history/recovery/staging and completed dependencies remain local. See
PRIVACY.md; removing the plugin does not remove user data/dependencies automatically.

## Evidence and release limits

500/500 source unit tests and 45/45 isolated browser regressions; final counts and
checks are recorded in STATUS current.md. Actual macOS ARM64 portable Python and
the complete setup flow were tested with all system interpreter probes denied in
an isolated Electron 22 environment: Python 3.13.16, gallery-dl 1.32.15,
video/Curl/AES components ready. No personal library or system installation changed.
Actual Windows archive HTTPS/SHA-256/extraction and PE layout were checked;
native Windows execution/ACL and ARM64 emulation remain unverified.

This evidence is not a final .eagleplugin installation test. Export through Eagle,
move/download and install that exact file on supported OS/Eagle builds. Replace
both live introductions and unreadable covers; the previously inspected draft
still had version 1.0.0 and the old Python claim, Chinese host returned HTTP 520.
Use docs/marketplace copy for the implemented 1.0.2 flow; no store/Figma changes
were performed.

[Preparation](https://developer.eagle.cool/plugin-api/publishing/prepare) ·
[Security](https://developer.eagle.cool/plugin-api/plugin-review/criteria/security-and-privacy)
