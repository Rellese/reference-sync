# ReferenceSync — moderation preflight, 2026-10-05

This records a source review, not approval or final package acceptance.

| Area | Result |
| --- | --- |
| Cookie snapshots | Shared Instagram/Pinterest/Behance helper: directory and file secured before writing, exporter .tmp reserved, verification after export, finally/exit/dead-process cleanup. Synthetic POSIX tests pass; actual Windows ACL/export remains a release check. |
| Authenticated archives | Canonical verified-platform HTTPS links and launch-boundary guard tested; off-host, userinfo and port inputs reject. |
| Setup | Requires user-installed Python 3.10+. Button installs gallery-dl/video dependencies. Windows manager auto-install disabled per child. Close stops preparation and allows retry; no implicit Python installation is advertised. |
| Sources | Instagram, Pinterest and Behance are adjacent. Remaining four unavailable. |
| Dependencies/network | Necessary subprocesses, selected social/CDN traffic, isolated Vimeo page, package index and local Eagle documented in PRIVACY/REVIEW. No developer analytics/upload endpoint. |
| Source regression | 492/492 Node tests; 45/45 isolated browser tests. After final cancellation refinement, 7/7 affected engine/process tests passed. |
| Runtime | Node 16.17.1/Electron 22.3.7 syntax checked; final changed files rechecked separately. This is not a packaged installation test. |
| Release inventory | 117 allowlisted production/support files, approximately 1.77 MB, dependencies present; --check creates no folder. Excludes Git/tests/cache/private data/nested Canvas. |
| Store text | English live draft still says Python is installed by the plugin and shows 1.0.0. Chinese host returned 520, not verified. Correct EN/ZH fields prepared in docs/marketplace. |
| Visuals | Both covers fail practical card-size readability. All eight supplemental slides inspected. Exact owner brief: docs/marketplace/VISUALS.md; no external design edits. |
| Final package | NOT tested in this review: an Eagle-exported .eagleplugin installed after moving/downloading, without the checkout, on current supported Windows/macOS. |

Before resubmission, replace both introductions and covers, upload the correct package/version, provide a usable private review account if required, and record final installation/import/cancel/cleanup results on both OSs. Previous live Behance successes do not substitute for this package check.

Official [release criteria](https://developer.eagle.cool/plugin-api/plugin-review/criteria/configuration-and-reviewability), [security](https://developer.eagle.cool/plugin-api/plugin-review/criteria/security-and-privacy), [functionality](https://developer.eagle.cool/plugin-api/plugin-review/criteria/functionality-and-policy), [prepare](https://developer.eagle.cool/plugin-api/publishing/prepare).
