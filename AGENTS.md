# plugumi

Plugumi の作り直しリポジトリ。規約・手順はこのファイルに書かず `.agents/skills/` のSkillに置く。

## 作業の進め方

- わからないこと・解釈が分かれることは、勝手に実装や移動を始めず、先にユーザーへ相談する。
- ユーザーが列挙した構成要素や検討課題を、明示されていないファイル移動・削除・改名の指示とみなさない。
- `packages/` と `shared/` は公開予定で分けない。`packages/` は汎用library / SDK / protocol補助実装、`shared/` はfirst-party component間で共有する実装（UIに限らない）とする。詳細は `docs/decisions/00026-packages-and-shared-directory-boundary.md`。
- 新しく決まった方針は、次に同じ質問が出る前に `docs/` の該当artifactへメモする。判断が曖昧なら、勝手に確定せず未決定として書く。
- installable packageの呼称はPluginに統一し、Extensionという語を現行概念として使わない。Pluginの基本概念はPlugin runtime / Plugin viewの2つとし、`entry`は基本概念にしない。詳細は `docs/decisions/00028-plugin-runtime-and-view-entries.md`。
- 前身プロジェクトmodstrataは参考程度に留める。このリポジトリはmodstrataの後継だが、悪いところをすべて再設計するためにある。そのまま移行せず、modstrataのソースは分からない部分を確認する参考としてだけ使う。
