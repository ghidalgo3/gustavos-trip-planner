# UX audit baselines

Save a reviewed fixture audit as `desktop.json` or `mobile-web.json` and pass its path as `--baseline` on a later run. Keep the audit JSON and its metadata together. The comparator matches scenarios, personas, browser environments, fixture identities and the effective rule configuration. HTML reports embed the cited screenshots and link to original images and interaction logs.

Commit baseline data only after checking it for account details, private trips and other private content. Use synthetic fixtures for shared baselines. Keep raw runs under `artifacts/ux/`.
