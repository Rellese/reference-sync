# Review notes — ReferenceSync 1.5.1

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

## Direct media compatibility (M6-T19)

Eagle Node 16.17.1 reproduces ERR_INVALID_ARG_TYPE for the legacy HTTPS call
with a foreign browser-style URL object. Download now passes the validated HTTPS
string to Node, including for redirects. The same real Layers video and photo
passed download/validation using the patched downloader and that URL model
(18,671,556 / 49,986 bytes); temporary media was removed. Tests cover foreign
URL objects, redirect allowlists, incomplete content, abort cleanup, Pinterest
MP4 fallback and safe diagnostic translations. Only fixed reasons/codes are
logged; raw error text, signed URL queries, paths and credentials are excluded.
691/691 automated tests passed; 118 JS modules parsed in Eagle Node 16.17.1.
Actual window/native import and
Windows acceptance remain pending, not replaced by CLI compatibility checks.

## Liked posts (M6-T18)

1.5.0 checks: 680/680 automated tests, 117 JS modules parsed by Eagle Node
16.17.1, local Chrome UI including EN/Chinese and reload/source changes. Live
Instagram N=10 with pagination and complete carousel metadata; first known/Stop
both return zero before detail. Instagram liked photo downloaded (362,004 bytes).
Layers liked video/photo downloaded and validated (18,671,556 / 49,986 bytes).
Behance own Appreciations list paged to 25, N=1 resolves a 12-block case. X/Vimeo
N=2 and known/Stop checked. Dribbble HTML/UI and fixture pagination checked, but
the live helper still receives HTTP 202; live acceptance stays pending.
No personal Eagle library was modified for these tests.

Step 1 offers a separate Liked posts mode on Instagram, Behance (Appreciations),
Vimeo, X, Dribbble and Layers. Browser owner only; archives/folders/manual account
and stale link targets are ignored. Full/smart/recent N and Stop Link keep their
usual boundaries. Import IDs are shared across Saved/Likes; search history is
separate, including cold reload, partial imports and deleted Eagle components.
Pinterest hearts are reactions, not a fabricated browsable saved-history feed.
Vimeo /me/likes overlaps the previously requested Favorites default.

Instagram requests only the website's fixed read-only Likes screen, refresh and
pagination handlers. It decodes bounded typed literals, never executes remote
JavaScript, Bloks actions or callbacks and never calls unlike. Web protocol version
is read from an official public static bundle using a separate cookie-free client.
See PRIVACY.md for endpoint/owner/filter checks and temporary cookie protection.
Dribbble uses native AJAX fragment pagination; HTTP 202 remains a site access
challenge and is not bypassed. Actual package/native OS acceptance is separate.

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
   Vimeo: Favorites by default, Watch Later/Showcases via folder selection;
   all three modes, Stop Link, video/showcase HTTPS links and one video per post.
   No archive/carousels/upload-folder scenario. Verify import in a test library.
   X: all Bookmarks by default, actual Premium bookmark folders when available,
   all three modes, Stop Link, HTTPS post links, attached photos/video/GIF/carousels.
   Text-only bookmarks count toward recent N but have no importable media.
   Archive and arbitrary profile feeds are not offered. Likes is a separate Step 1 choice. No extension/API key.
   Dribbble: all saved collections by default, selected collections with folder
   search on. Never use Liked Shots or own Work as a saved feed. Three modes and
   Stop Link; default recent N caps unique shots across collection display order,
   selected-folder N/boundaries are independent per collection. Shot/collection/
   public-profile-collections HTTPS links, media carousels and per-media captions.
   Each text block belongs to the preceding media; the shot title is shared.
   No compatible saved archive is confirmed. No browser extension or API key.
   Layers: all saved collections of the signed-in owner by default, selected
   collections with folder search. Never fall back to Likes/Explore/own uploads.
   Full/smart/recent and Stop Link; one image/GIF/video per work, work title and
   description, author separately. Default N caps unique works in collection
   order, selected-folder N/boundaries are independent. HTTPS work/collection/
   public-profile-collections links; no archive or carousel controls.
7. Synthetic archive HTTP links become verified-platform canonical HTTPS before
   browser-authenticated download; off-host/userinfo/port links must reject.
8. Test permissions, stop/recovery and cleanup on Windows and macOS. Supply
   dedicated account credentials only through private review fields, not code.

## Data and authentication

Eagle SDK preferred, localhost:41595 fallback disclosed. Browser-authenticated
Instagram/Pinterest/Behance/Vimeo/X/Dribbble/Layers flows share protected cookie snapshots: directory and
file permissions before writing, reserved exporter .tmp, verification after
export, finally/exit/dead-process cleanup. Windows ACL still needs a real native
browser export test. Interrupted snapshots may remain until a later cleanup.

The Vimeo adapter exports only Vimeo-domain cookies. Its temporary web JWT is
used in memory inside Python for authenticated Vimeo API requests, never returned
to JS or written to logs/files/arguments. Downloads enforce HTTPS before native
requests/redirects, only Vimeo and its video CDNs, and no external downloader.
macOS Chrome source testing covered Favorites N=15, Watch Later, known-ID boundary,
catalog (no Showcases returned), direct video and full FFmpeg validation. A real
nonempty Showcase, native Eagle import, Windows and other browsers remain pending.

Behance Vimeo recovery uses a temporary isolated player without browser cookies,
Node or Eagle API access, then validated Vimeo CDN HTTPS downloads. Signed stream
snapshots are private, excluded from arguments/logs/case archives and removed.
Settings/history/recovery/staging and completed dependencies remain local. See
PRIVACY.md; removing the plugin does not remove user data/dependencies automatically.

X shares the scoped, preprotected snapshot/control helpers with Vimeo. It reads
current platform query IDs from verified HTTPS static JS without executing that
code, uses only GET requests, and never falls back from a folder to all bookmarks.
Cookies/CSRF remain in the Python process; CDN downloads carry no browser cookies
and enforce HTTPS/host checks on every redirect. Video is fully FFmpeg-validated.
macOS Chrome testing found two video bookmarks under N=2 and downloaded/decoded
one 2.18 MB MP4. Native Eagle import, real Premium folders, Windows and other
browsers are still pending; the web API may change independently of the plugin.

Dribbble reads only scoped, private cookies and read-only HTTPS HTML. It combines
ordered content-block JSON with the corresponding rendered media URLs, without
executing scripts or returning unrelated account/payment/CSRF state. The installed
browser version supplies User-Agent; HTTP 202 asks the user to refresh Dribbble
in that browser instead of pretending the saved list is empty. CDN downloads have
no browser cookies and revalidate each redirect. Unknown shot layouts fail clearly.
macOS Chrome testing: 14 saved collections across catalog pages, default N=2,
selected-folder N=2, known/Stop boundaries=0, full small folder=8 shots/17 media.
A real mixed shot produced 5 media with their matching captions and shared title;
one 798,055-byte MP4 downloaded and fully decoded. Native Eagle import, Windows,
other browsers and a complete run through every personal folder remain pending.

Layers uses scoped preprotected cookies and read-only platform HTTPS APIs.
Its Remix bootstrap JSON supplies CSRF only in Python memory; page code is
never executed and unrelated account fields are discarded. Collection lists
use a flat nextCursor; layer lists use pagination.nextCursor/hasMore. Repeated
or invalid cursors fail instead of silently truncating. Only exact platform
storage hosts are allowed for downloads, without browser cookies; the video
object key follows the website's R2 mapping. Video is fully FFmpeg-validated.
Current live checks and remaining native/browser limitations: STATUS current.md.

## Evidence and release limits

Layers 1.4.0: 632/632 unit tests, 113 JS syntax checks in Eagle Node 16.17.1,
plus protected-cookie cleanup and title/description contracts. Signed-in Chrome
and the platform both confirmed an empty personal catalog. A public collection
and its known/Stop boundaries were tested with the production adapter; a real
2,577,334-byte PNG and 7,225,893-byte MP4 downloaded, the video fully decoded.
The actual UI starts with Layers active, hides archive/account/carousel filter,
and retains the translated saved-collection hint when switching languages.
A nonempty personal catalog, native import including SVG, Windows/other browsers
and the final .eagleplugin remain unverified. No personal library was modified.


Previous Dribbble source checks: 600/600 unit tests, 109 JS syntax checks in Eagle
Node 16.17.1, plus protected-cookie cleanup and naming contracts in that runtime.
Browser UI starts with Dribbble active, no archive/account field, and translated
saved-collection guidance that survives language changes. Separate clean project
and Git delivery are recorded in STATUS current.md; not an exported package test.

Previous X-only evidence:

563/563 source unit tests after the X addition; a further cookie-domain isolation
contract also passed in the 18/18 X Python helper run. 101 JS syntax checks and the
X/private-snapshot contract passed in Eagle's Node 16.17.1. The earlier
45/45 isolated browser regressions predate the Vimeo UI; current source checks
are recorded in STATUS current.md. Actual macOS ARM64 portable Python and
the complete setup flow were tested with all system interpreter probes denied in
an isolated Electron 22 environment: Python 3.13.16, gallery-dl 1.32.15,
video/Curl/AES components ready. No personal library or system installation changed.
Actual Windows archive HTTPS/SHA-256/extraction and PE layout were checked;
native Windows execution/ACL and ARM64 emulation remain unverified.

This evidence is not a final .eagleplugin installation test. Export through Eagle,
move/download and install that exact file on supported OS/Eagle builds. Replace
both live introductions and unreadable covers; the previously inspected draft
still had version 1.0.0 and the old Python claim, Chinese host returned HTTP 520.
Use docs/marketplace copy for the implemented one-button setup flow; no store/Figma changes
were performed.

[Preparation](https://developer.eagle.cool/plugin-api/publishing/prepare) ·
[Security](https://developer.eagle.cool/plugin-api/plugin-review/criteria/security-and-privacy)
