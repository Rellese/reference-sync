# Review notes — ReferenceSync 1.0.0

## Current submission — 2026-10-21

Version 1.0.0 intentionally replaces development version 1.6.1 for the first
public submission. This is a version-label reset, with no removal of features.
The source audit and tests are distinct from installing the final Eagle package.
Cookie snapshots are protected before export (0700 directory, 0600 destination
and replacement), checked after export and cleaned after use/abnormal exits.
Authenticated archive links are normalized to verified platform HTTPS URLs and
checked again before invoking the downloader. Explicit one-button preparation
can install a separate Python when none is compatible; the old rejection-letter
requirement to preinstall Python described an earlier implementation.

Before submission: install/test the actual Eagle-generated package, verify both
localized covers at marketplace-card size, supply review-account access privately
when required, and complete native Windows acceptance. No credentials belong in
this folder. See docs/RELEASE.md for the current submission checklist.

## Threads evidence (M6-T29, development version 1.6.0)

Eighth source with the owner's SVG from commit 173f352. Saved and Likes use
separate connections owned by the selected Threads browser session. HTTPS
post links on threads.com and threads.net resolve a single post, not replies
or subsequent posts in its conversation. No manual account field, extension,
API token, separate dependency or invented folder selection is required.

Read-only page JSON supplies posts, the verified viewer and pagination variables.
Only the matching Saved/Liked RefetchableQuery ID is read from public static
bundles without cookies or JavaScript execution. API calls are HTTPS and do
not follow POST redirects. Source cookies are restricted to Threads domains;
private snapshots reuse the existing protected creation/verification/cleanup.
Tokens stay inside Python. Selected normalized metadata is returned; responses,
tokens, cookie contents and signed-URL error messages are not logged.
Media downloads use only Meta CDN HTTPS URLs, without browser cookies.

Photo/video/mixed carousel order and completeness, smart/full/recent, known/Stop
boundaries, cancellation, private files, link/archive routing, selected-component
download, recovery and cross-feed IDs have synthetic regression coverage.
790/790 tests passed; 127 JS modules parsed in Eagle's Node 16.17.1. Inside
Native Eagle with Chrome Profile 1, production source calls verified the viewer,
completed Saved traversal without interruption: 324 checked, 316 with media,
7 text-only and 1 explicit format failure. The failure was traced to HEIC images
in a six-component mixed carousel. After adding HEIC to the existing image
extension allowlists, its direct link returned all six components (five HEIC
images plus a video); the full 324-post traversal was not repeated after this
local format fix. It also verified recent=2, known/Stop first=0,
Liked recent=22 (15 with media and 7 text-only, including pagination) and a single post link. Twenty-seven mixed carousels were found.
One image and one video (1,322,168 bytes total) downloaded through the production
adapter; the video passed full decoding. The diagnostic initially omitted the
normal video preflight: the same two media passed after calling the same
preflight used by main.js, without a production code change. Private snapshots
were cleaned; private research JSON and test staging were removed. No Eagle
library items were created. A live pagination defect was fixed: HTML preloading
can overlap several API pages. Advancing cursors now continue through those
duplicates; repeated/missing cursors still interrupt instead of claiming completion.
Isolated production UI checks covered the eighth icon and all five languages
plus Saved/Link/Likes/Archive.

Pending: download of every component of a real mixed carousel, actual library
import for Threads, other browsers/Windows and the installed .eagleplugin.
A real device-only Meta export was prepared with the owner's approval: Threads
profile, only the Threads activity category, JSON, all time. The ZIP is 17,823,815
bytes. Its Saved list contains 324 records, matching full browser discovery;
Likes contains 672 records. In Eagle Node 16.17.1, the production reader extracted
only threads/saved_threads.json and returned 324 links / zero local posts.
Likes, own media, profile and other sections were not extracted or mixed into
Saved. The order was newest first. Parsing the explicitly selected standalone
Liked JSON also returned 672 links. Two real Saved archive links resolved to
complete posts through one selected-profile session, without media downloads
or Eagle additions. There were zero residual cookie files; temporary data was
removed, and the owner's original ZIP remained byte-for-byte unchanged.
Text-only links are checkpointed as processed and counted as skipped, as in
browser discovery. Missing Saved in an identifiable Meta Threads ZIP is an
explicit error; malformed/incomplete media remains retryable instead of silently
substituting previews. The build remains a review candidate pending the above
platform/package/library-import checks.

## Browser account without manual login (M3-T11, 1.5.5)

Instagram/Pinterest no longer display a manual username field or a replacement
account row. The existing profile tooltip remains. Saved/collection discovery
uses the owner freshly verified in the selected browser profile, never a cached
tooltip or an old typed login. Unverified/signed-out sessions still stop the
operation; private cookie permissions and cleanup remain enforced. Retired
settings are cleared after the legacy Behance URL migration. Links/archives
do not depend on a manually supplied account.

Native Eagle / Chrome Profile 1: Instagram and Pinterest each discovered one
Saved publication with a deliberately obsolete test username. Instagram returned
two collections and one Likes publication. Private snapshot files were removed;
no media or library items were created. Isolated production UI checks covered
both sources in all five languages, Saved/Link/Archive and Instagram Likes.
747/747 tests passed. Pinterest boards/sections, other browsers, Windows and
the final installed package were not retested for this change.

## Dribbble discovery recovery (M6-T27–T28, 1.5.4)

Modern block JSON supplies original uploads, matched to declared media IDs and
ordered slides. Lazy DOM rendering is no longer required when this complete
metadata is present. Missing, ambiguous or foreign uploads reject the whole shot.
Format failures retain other complete posts and identify failed shot URLs. Recent N
counts unique attempted shots, including failures. Access/rate/network interruptions
stop the queue, retain complete posts and show an explicit warning. User stop and
URL/integrity failures are not disguised as successful discovery.

Public-page rendering has no modal or focus. Each guest remains sandboxed without
selected-profile cookies, Node, preload or popups. One nonpersistent partition is
used within an operation; after the first public HTTP 202, subsequent public shots
are read through it without repeating failed HTTP requests. Authenticated lists
still use scoped cookies from the selected browser. This does not control Chrome,
Firefox, Edge or Yandex themselves. CAPTCHA/access refusal is never solved silently.

Native Eagle / Chrome Profile 1: Saved recent=10 returned 10 shots / 19 components;
known/Stop first returned 0 before metadata; two selected collections recent=1
returned 2; one selected collection full returned 8; Likes recent=25 returned 25
across two pages. Short/full links to a slideshow returned five components.
One image and one video original were downloaded and validated without importing
new library items. A controlled second-page refusal retained the real first shot,
reported its interruption and cleaned guests/private files. One earlier link check
received a transient challenge; both later address forms passed. The owner's exact
historical FORMAT failure was not reproduced, so its unique cause is not claimed.

738/738 tests; 120 JS modules parsed in Eagle Node 16.17.1. Full default-history,
other browsers, Windows and the final installed package remain pending. A single
live timing comparison for safe Saved=10 changed from about 126 to 72 seconds;
this is not a fixed performance guarantee.

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

## Panel sizing (M3-T10, 1.5.3)

The lower separator resizes only results and naming. The progress track uses
its intrinsic height; naming's limit reserves status height, grid padding/gaps
and the 100px minimum result area. Status resize updates this limit.
Isolated Chrome checks used real components/styles at the 1200x760 minimum:
complete=97px and downloading=141px remained unchanged at both endpoints,
mouse drag and double-click reset. Stored sizes are clamped on reopening.
No account, download or Eagle library operations were used for this check.

## Current acceptance (M6-T20–T26, 1.5.2)

Authorized macOS/Chrome checks used production adapters in Eagle Node 16.17.1.
X: 30 media bookmarks and 48 media Likes; Layers: 4 Saved and 67 Likes;
Vimeo: 511 Favorites/Likes and one Watch Later video. Recent N, known/Stop
boundaries, links and available folder selection passed. X Premium folders
were unavailable in this account; ordinary bookmarks passed. Real files were
downloaded/decoded, imported into a dedicated test folder, read back by ID,
and shared Saved/Link/Likes import IDs were checked. One Layers and one Dribbble
duplicate were cancelled by the owner in Eagle; neither was re-added or counted
as a live file. The dedicated folder retains 21 verified items, including 12
Dribbble blocks. Reconciliation keeps both cancelled components incomplete;
complete posts have zero repeat imports across Saved/Link/Likes.

HTTP add returns a queued ID before the file exists. Its fallback now waits
for read confirmation; uncertain writes remain blocked, including after reload.
Native addFromPath still uses Eagle's own completion acknowledgement.
Without selected folders, Dribbble/Layers known/Stop boundaries now stop the
whole saved search; selected-folder boundaries remain independent.

Dribbble public shot HTTP 202 can use a temporary, isolated Eagle webview.
No browser extension/profile/cookies, preload, Node or popups are passed to
the remote page. Standard page JavaScript runs in the sandbox; the plugin
does not separately execute challenge code or automatically solve CAPTCHAs.
Only the exact public HTTPS shot may be captured. Bounded DOM HTML is passed
through a precreated 0600 file in a 0700 directory, then removed with the guest.
Python still parses block JSON and media without executing scripts. Authenticated
bootstrap defines the owner; public collection links/grids validate subsequent
pages even when their navbar is hydrated later. Login/error HTML is not an empty feed.

Native Dribbble: catalog 14, Saved/Likes recent=2, known/Stop first=0, two links,
selected-folder recent=2 and full=8; four sample posts downloaded as 13 media.
12 accepted blocks were read back with names, per-block annotations and URLs.
Both INITIAL_STATE and JsConfig.shotData are decoded as strict JSON only, with
shot/block ID and completeness checks. Extended Likes pagination returned
25 unique shots over two native Likes pages, including nested
slideshows expanded completely without thumbnail duplicates. The following
slideshow caption belongs to each slide. 721 automated checks and 120 JS modules
parsed in Eagle Node 16.17.1 passed; these do not replace unperformed live checks.
Read-only smoke: Pinterest Saved recent=1 returned one pin; Behance catalog=25
and selected-board recent=1 returned one 125-component case. Instagram has no
valid session in the selected Chrome profile; live smoke awaits the owner login.
Windows and other browser profiles were not live-tested in this acceptance;
the exported .eagleplugin remains a separate release check. Earlier results
below are historical and do not supersede this section or STATUS.

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
