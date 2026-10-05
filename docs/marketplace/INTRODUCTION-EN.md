# ReferenceSync

Import Instagram, Pinterest and Behance references into Eagle. Review results, select media, customize names and descriptions, and keep source links and tags.

## Getting started

**Click Prepare engine. No manual Python installation or terminal is required on supported macOS/Windows systems.**

The button first looks for a compatible existing Python 3.10+ with pip. If none is available, it downloads a separate portable Python from Astral's python-build-standalone GitHub release, verifies its pinned SHA-256, and installs it in the ReferenceSync working folder. It then installs gallery-dl, yt-dlp with curl_cffi, pycryptodomex and imageio-ffmpeg from your configured package index, normally PyPI. System Python, PATH and the registry are not changed; administrator rights are not required. Windows ARM64 uses x64 emulation and requires Windows 11.

Setup downloads occur only after pressing the button. Opening the plugin or checking components never installs Python automatically. Setup can be cancelled by closing the plugin; incomplete files are cleaned and preparation can be retried.

Sign in to the selected service in your browser, choose that browser/profile, search, review your selection, then download and add it to Eagle.

## Supported workflows

- Saved Instagram posts and Pinterest pins, collection filtering and individual media selection.
- Behance blocks, complete projects as .rscase, or both. **Install the separate ReferenceCanvas plugin to view .rscase in Eagle.** ReferenceSync does not install it.
- Supported Instagram/Pinterest ZIP, JSON and HTML archive metadata. Publication links are resolved online; having an archive does not guarantee media access without login or internet.
- Search new posts, all saved posts or a limited number of recent posts. Apply optional numbering before import. Library-specific history helps avoid duplicates.

Dribbble, Vimeo, X and Layers are unavailable source buttons in this release. Website changes, browser cookie protection, account access, unavailable media and rate limits can prevent online downloads.

## Data and access

The plugin does not ask for passwords. Cookies from the selected browser/profile authenticate requests to the selected service. Temporary cookie snapshots are private before export, verified afterward and deleted after use. After an unexpected exit, stopped-process snapshots are cleaned on a later launch; legacy snapshots without a process ID are cleaned after 24 hours.

Some Behance videos use an isolated temporary Vimeo player inside Eagle. It runs Vimeo's own code without Node.js or Eagle API access and does not receive your selected browser cookies. The downloader accepts only validated Vimeo CDN HTTPS URLs.

Settings, import history, recovery data, the separate Python, dependencies and download staging remain locally under .reference-sync in your home directory. Unfinished downloads may remain for recovery. Selected files and metadata are added to Eagle; original browser data and archives are not deleted. No analytics or developer upload service is used. Connections serve the selected websites, their media services, your package index and the local Eagle API. Uninstallation does not automatically remove working data. Read the bundled privacy notes before sharing logs or working folders.
