# Changelog

## 0.2.3 — 2026-11-20

- fix: stop announcing delegated turns. A subagent or agent-team member finishing
  no longer raises a toast; only root sessions do. A new "子 Agent / 团队完成也提醒"
  switch (off by default) restores the old behaviour. Waits (approvals, questions,
  plan reviews) still notify for children, because those need the user.
- fix: the toast AUMID is now `com.deepseek.dsh`, the id the desktop app and its
  Start Menu shortcut register. The previous `electron.app.DeepSeek Harness` was
  unregistered, so Windows printed the raw id as the source name and showed no icon.
- docs: README, PLAN and AGENTS describe the AUMID requirement and the new switch.

## 0.2.2 — 2026-11-07

- feat: localized plugin display metadata (`locale/zh.json`, `locale/en.json`).

## 0.2.1 — 2026-10-19

- Replaced the electronic preset pack with eight warm, phone-style tones:
  aurora, marimba, kalimba, glass, bubble, low, descend, bloom.
- Soft attacks, a small room tail, and RMS-normalized loudness; no square-wave alarm.
- Settings moved from the Settings page to the **dsh-bing** plugin detail page
  (`plugins.bundle.config`, key `dsh-bing`).
- Preferences moved to `dsh-bing.v2`; v1 switches are preserved, sound choices reset
  to the new pack.

## 0.2.0 — 2026-10-19

- First working implementation: session projection, Windows toast routes, project-name
  title, session title + summary body, focus suppression, dedupe, reminders.
- Eight selectable sounds with preview, custom import/delete, transcode cache.
- Settings UI and exact no-dependency build.

## 0.1.0 — 2026-10-19

- Repository scaffold, sound catalog, and implementation plan.
