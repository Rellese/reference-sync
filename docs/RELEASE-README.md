# ReferenceSync

Import selected references into Eagle from Instagram, Pinterest, Behance,
Vimeo, X, Dribbble, Layers and Threads. Available sections depend on the source:
Saved, Liked posts, direct publication links and collections where supported.
Supported Instagram, Pinterest and Threads archive exports can provide links
or local media; online links still require internet access and authorization.

## Getting started

1. Install ReferenceSync in Eagle and open it from the plugin panel.
2. Click **Prepare engine** if requested. Preparation begins only on your click.
3. Sign in to the source in your browser. Select that browser and profile in Sync.
4. Choose a source, section and search mode. Start with the latest two posts.
5. Select publications or media components, edit names/descriptions, choose an
   Eagle folder, then download and add the selected materials.

Search supports new-only, full and latest-N modes, selected folders where
available and a stop-at-link boundary. N counts checked publications, which
may include posts without downloadable media. Request speed is configurable.
History is scoped to the Eagle library. Pause, stop and unfinished-job recovery
preserve confirmed progress; unavailable media or site restrictions are reported.

Behance projects can be saved as complete `.rscase` files, individual blocks or
both. Install the separate **ReferenceCanvas** plugin to view complete cases.
One whole case consumes one numbering slot, followed by its selected blocks.

## Engine and installation

A compatible Python 3.10+ with pip can be reused. Otherwise **Prepare engine**
downloads a separate portable CPython from Astral python-build-standalone on
GitHub, verifies its pinned SHA-256, and prepares gallery-dl, yt-dlp/curl_cffi,
pycryptodomex and imageio-ffmpeg from the configured package index (normally PyPI).
The portable copy is kept under `~/.reference-sync/python`. System Python,
PATH and registry settings are not replaced. Windows ARM64 needs Windows 11
x64 emulation. Internet access to these dependency sources is required.

The interface supports English, Russian, French, Spanish and Simplified Chinese.
Use the language buttons in ReferenceSync to select a language.

## Privacy and local files

No social password is entered into ReferenceSync. Browser cookies authenticate
the selected service; private temporary snapshots are protected before export,
checked afterwards and removed after use. Stopped-process leftovers are cleaned
on a later launch. Authenticated archive links are verified platform HTTPS URLs.

Necessary connections include the selected websites/media CDNs, dependency
sources and local Eagle integration. Some Behance video and Dribbble checks use
isolated temporary pages inside Eagle without selected-browser cookies or Node
access. No analytics or developer-upload service is included.

Settings, import history, recovery data, dependencies and temporary downloads
are stored under `~/.reference-sync`. User archives and browser source files
are preserved. Verified Behance packages replace disposable source blocks;
separately selected blocks remain until processing finishes. Confirmed temporary
imports are cleaned; extra disk space is needed during download/assembly/import.

Uninstalling the plugin does not remove its data folder. Close ReferenceSync
before manually deleting `~/.reference-sync` if you want to remove all local data.
See `docs/PRIVACY.md` and `docs/MANAGED-PYTHON.md` for details.

Site access, protected browser cookies, account capabilities, rate limits,
network availability and media codecs can affect results. ReferenceSync does
not grant access to content unavailable to the selected account.
