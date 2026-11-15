---
name: branch-convention
description: ブランチ命名規約。GitHub Flow で、main には直接 push せず <type>/<slug> の topic branch から PR 経由で取り込む。ブランチ作成時に使う。
---

# Branch convention

GitHub Flow。`main` には直接 push せず（ruleset で保護済み）、topic branch → PR で取り込む。

ブランチ名は `<type>/<slug>`。type は Conventional Commits と同じ種別（`feat` `fix` `docs` `chore` 等）、slug は kebab-case。例: `chore/init`、`feat/add-panel`
