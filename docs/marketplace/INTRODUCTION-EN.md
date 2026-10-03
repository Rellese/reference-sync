# ReferenceSync

Import selected posts and media into your Eagle library. Review the results, choose what to import, and keep source links and descriptions with your references.

## Before you start

**Install Python 3.10 or later yourself before preparing the download engine. ReferenceSync does not install Python.**

After Python is installed, ReferenceSync can install or update gallery-dl using that existing Python installation. Additional video components, including yt-dlp and FFmpeg, are prepared through the plugin when needed. Dependency downloads require an internet connection and your explicit action in the plugin.

For browser-authenticated sources, sign in to the relevant service in a supported browser and choose that browser/profile in ReferenceSync. The plugin does not ask for your account password. Availability depends on the source website, your account access, and the browser's cookie protection.

Temporary browser cookie snapshots are created in a private directory and removed after use. Interrupted snapshots are cleaned up on a subsequent start; legacy snapshots without an owner ID are removed after 24 hours. Archive publication links used with browser authentication are validated and use HTTPS.
