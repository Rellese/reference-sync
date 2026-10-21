# Review notes — ReferenceSync 1.0.0

Prepared 2026-10-21. Version 1.0.0 replaces development 1.6.1 for the first public
submission; implemented features have not been rolled back.

## Purpose and setup

Window plugin importing selected references into Eagle. Sources: Instagram,
Pinterest, Behance, Vimeo, X, Dribbble, Layers and Threads. Browser sign-in and
access to each website are required for account feeds. Site restrictions,
rate limits and inaccessible media can prevent downloads. Complete Behance
.rscase viewing requires the separately installed ReferenceCanvas plugin.

Only clicking **Prepare engine** downloads components. An existing compatible
Python 3.10+ with pip is reused; otherwise a separate portable CPython is installed
under ~/.reference-sync/python. Astral python-build-standalone release URLs,
archive sizes and SHA-256 are pinned in js/python-builds.js. Redirects and extraction
are restricted; incomplete installs are cleaned and can be retried. No PATH,
registry, administrator access, system installer or permanent background service.
The button then installs gallery-dl, yt-dlp/curl_cffi, pycryptodomex and
imageio-ffmpeg from the configured package index (normally PyPI). See MANAGED-PYTHON.md.
Windows ARM64 requires Windows 11 x64 emulation. Native Windows execution still
needs acceptance; the portable installation was exercised on macOS with all
system-Python probes disabled.

## Reproduce the core workflow

1. Package this clean folder through Eagle. Install the resulting .eagleplugin
   into a test environment and launch ReferenceSync.
2. Prepare the engine if needed. Sign in to a service in a supported browser;
   select that browser and profile. No password is entered into the plugin.
3. Select Saved, Liked posts where offered, or an HTTPS publication link.
   Use recent N=2 before testing full/new-only search or selected collections.
4. Select posts/components, edit names/descriptions and choose a disposable
   destination folder in Eagle. Confirm that created items open, preserve order,
   metadata and source links, then repeat search/import to check duplicates.
5. Test stop/recovery, cancelled dialogs, invalid links, missing authorization,
   network errors and an unavailable media component. Do not count queued IDs
   or cancelled duplicates as successful imports.
6. For archive testing, select supported Instagram/Pinterest/Threads ZIP/JSON/HTML.
   Full Threads exports read Saved only, not unrelated profile/own-post data.
   Text-only Threads posts are skipped. Media links still require online access.
7. Behance: download a complete .rscase and separately selected blocks, then
   open the case with ReferenceCanvas. One complete case consumes one numbering
   slot; separately selected blocks follow it in table order.

Provide dedicated review-account access privately in the submission form if
reviewers need it. Never put credentials, personal exports or browser profiles
inside the plugin. No account belonging to the developer is bundled.

## Security, data and external connections

- Browser cookies authenticate only the selected source workflow. Private
  snapshots use a 0700 directory and precreated 0600 destination/replacement
  before export; permissions are checked after writing and snapshots removed
  in finally. Dead-process snapshots are cleaned on later launch; legacy files
  without an owner PID are cleaned after 24 hours. Windows uses private ACLs.
- Authenticated archive URLs are canonical platform HTTPS URLs and checked again
  before the downloader runs. Requests reject credentials in URLs and unsupported
  destinations. Temporary tokens/cookies and signed URLs are not written to logs.
- Required connections serve the selected sites, validated media/CDN services,
  GitHub release storage for Python, the configured package index and disclosed
  local Eagle integration. There is no analytics or developer upload endpoint.
- Some Behance video and Dribbble access checks use isolated temporary webviews.
  No Node, preload, Eagle API, selected browser cookies, popups or persistent
  session are exposed to the remote page. Only validated results are consumed;
  webviews and temporary files are destroyed afterwards. No CAPTCHA solver.
- Local settings, library-specific history, unfinished jobs, staging and installed
  dependencies remain under ~/.reference-sync. Source browser files and original
  user archives are not deleted. Uninstallation does not remove this working
  folder automatically; close the plugin before removing it manually.
- Complete Behance cases are assembled and verified before disposable source
  blocks are removed. Separately selected blocks remain. Completed staging is
  retained until Eagle confirms import; failure/recovery must not silently lose
  the only verified copy. Downloads can temporarily require additional disk space.

## Verification and limits

2026-10-21: 790/790 unit tests passed, including private-cookie creation/cleanup,
HTTPS, archive parsing, Python download/hash/extraction/cancellation, source
pagination, selection, import/recovery and duplicate handling. These are source
tests, not a claim of cross-platform approval. Historical live evidence is kept
in the development repository, outside this clean package.

Prior macOS tests used actual Eagle/Chrome sessions for the added sources and
real media. Threads has native Saved/Likes/link/archive and image/video-download
evidence, but final library import of a mixed Threads carousel remains unverified.
Other browsers, native Windows, final packaged installation, both localized
store covers and the rendered store listing require separate acceptance.

Official criteria: https://developer.eagle.cool/plugin-api/plugin-review/criteria
Packaging: https://developer.eagle.cool/plugin-api/publishing/package
