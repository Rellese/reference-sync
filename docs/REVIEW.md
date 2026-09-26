# Review notes — ReferenceSync 1.0.1

This is a release-preparation candidate, not a submission-ready build.
No review credentials or personal data are included.

## Dependencies and behavior

Eagle window plugin using its JavaScript API, with a localhost:41595 fallback
for library operations. Python 3 and gallery-dl are required for online
sources. The Download/Update action runs pip against the configured package
index (normally PyPI) and installs gallery-dl into the user's plugin runtime.
No downloaded executable is bundled. Python's ensurepip may be used if pip
is missing. Browser cookies authorize requests to the selected social source.
Pinterest uses a temporary cookie export with cleanup in finally.
See PRIVACY.md for retention and crash limitations.

## Reproducible test

1. Use a disposable Eagle library and a dedicated reviewer browser profile.
2. Sign in to the social account in that profile; use an account containing
   a photo, a video, image and mixed carousels, and at least two collections.
3. Import the clean project or install its Eagle-generated package. Prepare
   gallery-dl through the UI; explicitly verify both dependency-present and
   dependency-missing cases.
4. Select that browser/profile; confirm account identification. Test all,
   recent N, and new-only discovery, with and without collection selection.
5. Test Stop Link before and after the known imported boundary. Select only
   part of a carousel, edit names, then import to the disposable library.
6. Confirm actual media and metadata in Eagle, repeat to verify duplicates,
   interrupt a download, reopen and resume. Test network and login errors.
7. On a filled table drag every column divider and double-click to reset;
   confirm the window remains responsive and selection persists.
8. Switch all five interface languages, resize the window, and hover the five
   unavailable sources. They must show the future-support tooltip and never activate.
9. Repeat on Windows and macOS after installation of the final .eagleplugin.

The owner must provide any account required by the review process privately
through the official submission form. Never commit credentials. No review
account has been created or supplied by this project.

## Evidence and remaining gates

299 unit tests and 23 browser scenarios pass. Native Eagle on macOS confirmed
Pinterest account identification for one profile and removal of the column
cursor crash. Complete live online import/recovery and installed-package
checks on both operating systems remain pending. Do not describe untested
sources or platforms as verified in the store listing.
