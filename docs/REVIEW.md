# ReferenceSync — review notes, 1.0.1

Source candidate reviewed 2026-10-05. Source tests do not establish that the final .eagleplugin is ready on both operating systems.

## Dependencies and data

Window plugin; Eagle SDK preferred, with localhost:41595 fallback for library operations. Install Python 3.10+ separately. The explicit preparation/update button installs gallery-dl, yt-dlp with curl_cffi and imageio-ffmpeg through pip into ~/.reference-sync/runtime. It uses the configured Python index, normally PyPI; ensurepip may prepare missing pip in the selected Python installation. No Python or other executable is bundled. Python Install Manager auto-install is disabled only in child-process environment. Closing aborts preparation, including lookup, pip and verification.

Browser cookies are used only for the selected source/profile. Instagram, Pinterest and Behance share precreated private snapshot files and their reserved exporter .tmp file. POSIX: 0700 directory, 0600 file before export and verification afterward. Windows: current-user ACL before writing and file ACL verification. Finally/exit cleanup and next-launch dead-process cleanup apply; legacy snapshots expire after 24 hours. See PRIVACY.md.

Authenticated archive links are validated against supported platform hosts, canonicalized to HTTPS, and checked again before gallery-dl launch. Normal jobs disable cookie rewriting. Behance Vimeo recovery uses an isolated nonpersistent player without browser-profile cookies/Node/Eagle APIs, then a validated HTTPS CDN downloader. Fixed scripts read player configuration, not arbitrary user code. Signed stream snapshots are private and excluded from arguments/logs/archives.

## Reproduce

1. Install the final Eagle-generated package in a disposable library, without the original checkout. Use a dedicated browser profile and review account; supply credentials only through private submission fields.
2. Verify missing Python stops setup clearly without installing it. Install Python separately, prepare the engine and test cancellation/close and retry.
3. Instagram and Pinterest: search saved collections, select an image/video/carousel, import, repeat without duplicates. Exercise new/all/recent modes and stopping.
4. Behance: select moodboards or a project link, test all three modes (limit applies per selected board), import a complete case and independent blocks. Install separate ReferenceCanvas to preview .rscase; Sync does not install it.
5. Use synthetic ZIP/JSON/HTML archive metadata with HTTP publication links: supported links become canonical HTTPS, off-platform/userinfo/port links reject before cookie-authenticated download.
6. Interrupt/reopen/recover; check unavailable login/media/network errors and cookies/temp cleanup. Exporter logs should not expose cookie values.
7. Test Windows ACL with a real browser export and macOS POSIX permissions. Check the actual released browsers/OS/builds, rather than assuming synthetic tests cover all browser security schemes.

## Evidence and submission

492/492 Node tests passed; UI selection/import regressions are recorded in STATUS current.md. Node 16.17.1 syntax passed. Read-only release inventory: 117 files, about 1.77 MB; --check creates no release directory. Tests, .git, private/runtime files, downloaded media, nested Canvas copies and local design drafts are excluded.

Prior recorded live Behance evidence tested three projects including 13 videos after Vimeo recovery. It does not establish that all accounts/networks/browsers or a newly exported package work.

Before resubmission: replace the old Python claim in both live introductions, replace both unreadable covers, upload the correct package/version, and install that exact .eagleplugin on Windows/macOS. The English draft inspected still has version 1.0.0 and incorrect Python copy; the Chinese host returned HTTP 520. Local listing fields/visual brief are in docs/marketplace. No store or Figma changes were made.

[Preparation](https://developer.eagle.cool/plugin-api/publishing/prepare) · [Security](https://developer.eagle.cool/plugin-api/plugin-review/criteria/security-and-privacy) · [Listing](https://developer.eagle.cool/plugin-api/plugin-review/criteria/store-listing-copy) · [Package contents](https://developer.eagle.cool/plugin-api/plugin-review/criteria/package-contents)
