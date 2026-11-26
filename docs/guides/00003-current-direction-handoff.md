---
type: guide
title: 現在の設計方向の引き継ぎ
description: UI App、built-in、Plugin、runtime lifecycle、packages/sharedに関する直近の決定と未決事項を次の作業者へ引き継ぐ。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00019'
    - '00021'
    - '00022'
    - '00024'
    - '00025'
    - '00026'
    - '00027'
    - '00028'
    - '00029'
---

## 目的

この文書は、用語と構成について直近で決まった方向を短く引き継ぐためのものである。正本は各decision / architecture / contractであり、この文書は入口と要約に留める。

## まず読むもの

1. [Architecture 00003](../architecture/00003-daemon-centric-workbench-platform.md) — daemon中心platformの全体像
2. [Decision 00029](../decisions/00029-ui-app-and-built-in-terminology.md) — UI App / built-inの命名と、分類語を増やさない方針
3. [Decision 00022](../decisions/00022-built-in-plugin-boundary.md) — built-inとPluginの境界
4. [Decision 00028](../decisions/00028-plugin-runtime-and-view-entries.md) — Plugin entryはruntime / viewだけ
5. [Decision 00019](../decisions/00019-multicore-plugin-process-ownership.md) — managed plugin runtimeは1 Coreごとに1 process
6. [Decision 00024](../decisions/00024-operation-invocation-context-and-execution.md)と[Contract 00004](../contracts/00004-plugin-client-protocol.md) — operation invocation / Executionの方向

## 用語の最新方向

- Web / Electronの公式UIは **UI App**。個別には **Web app** / **Electron app**
- `App` 単独や `Workbench Host` は正式名にしない
- `標準装備` / `標準搭載` は使わず、**built-in** を使う
- `built-in` は実装場所ではなく、追加installなしで使える製品の基本体験を指す
- `first-class` / `baseline` / `bundled` / `official plugin` / `bundled plugin` / `built-in plugin` は現段階では正式な分類語にしない。必要なら普通の日本語で説明する
- installable packageは **Plugin**。Extensionという語は現行概念として使わない
- Pluginのentryは **runtime entry** と **view entry** だけ。client entry / workbench entryは廃止
- `Host Capability Provider` は独立した第一級概念として扱わない。UI Appがapp-local capabilityをCoreへ登録するものは **UI App capability** と呼ぶ。内部実装ではprovider protocolを使ってよい

## 構造の最新方向

```text
Core Daemon
UI App（Web app / Electron app）
Environment Provider
Plugin
```

重要な区別:

- Environment Providerはprovider protocolを使うがPluginではない
- UI App capabilityもprovider protocolを使うがPluginではない
- provider protocolを使うことと、Pluginであることは別の話である
- UI Appはpluginではない。shell構造の大幅な改造はfork / downstream host側の話にする

## managed plugin runtime

- managed plugin runtimeは `1 Core : 1 provider session : 1 runtime process`
- 同じPluginを複数Coreでenableにした場合は、既存processへCore接続を追加せず、Coreごとに独立したprocessを起動する
- Plugin内部でshared backendを持つかはPlugin作者の自由。Plugumiがmanaged lifecycleとして見るのはCoreごとのruntime processだけである
- shared runtime自体が複数Coreへ直接接続するなら、managed runtimeではなくself-managed / external serviceとして扱う

## UI /実装の最新方向

- 公式UI実装はSolidへ統一する。Panel / View protocol自体はframework非依存のままにする（[Decision 00025](../decisions/00025-official-ui-framework-solid.md)）
- Electron Site PanelはSvelteからSolidへ移行済み
- `packages/` は汎用library / SDK / protocol補助実装。`shared/` はfirst-party component間で共有する実装。公開予定で分けない（[Decision 00026](../decisions/00026-packages-and-shared-directory-boundary.md)）
- `packages/plugin-client` はlegacy。責務が混ざっているため、operation / Execution移行の中で新しいTypeScript / Node.js向けlibraryへ分解し、最終的には消す方向（[Decision 00027](../decisions/00027-client-library-languages-and-framework-bindings.md)）
- `@plugumi/plugin-view` はいったん残すが、UI lifecycleそのものの所有者はWorkbench shellであり、plugin-viewは作者向けcontract / helper / type / design tokenに寄せたい

## built-in / pluginの現時点の帰属

- terminal — built-in。PTYはenvironment、viewはplatform
- file explorer — built-in view
- DiffViewer — built-in。git意味には依存しない
- Electron browser automation — Electron appのbuilt-in capability
- filesystem / shell / process — built-in environment capability。Environment Providerが実装する
- git — built-inにしない。plugin寄り
- docker / ssh remote provisioning — plugin。接続後はremote environmentへの共通経路に収束する
- AI agent — 一旦built-inにしない。pluginとして扱い、MVP検証後に見直す

## 未決・注意

- `Environment` という名前自体はまだ納得していない。ただし `Environment Provider` がPluginではないことは決まっている
- `packages/` に置くTS向けCore client / provider libraryの名前と分割は未決定
- `shared/` の境界、特に `shared/workbench` とhost固有実装、environment panelの置き場は詰め切れていない
- managed plugin runtime processのspawn ownerは未決定。Core Daemon local process manager、CLI invocation、Environment Provider mediated pathのどれにするか
- wire field / enumの `providerKind: "host"`、`hostSession`、`host-session` は現行contract revisionでは改名しない。改名するならcontract revisionの変更として扱う
- `official` と `bundled` の区別は、実際に外部配布やplugin配布を設計するときまで持ち越す。今は用語を増やさない
- 多くのarchitecture / decisionはまだdraft。acceptedな旧docsには `Plugin` / `UI Host` / `Tool` 時代の表現が残っている。歴史記述まで機械的に消さないこと

## 検証

docsのlink / frontmatter / relationは、少なくともこの引き継ぎ作成時点では簡易チェック済み。実装側の確認は変更範囲に応じて次を使う。

```sh
pnpm --filter plugumi-electron-ui build
pnpm --filter plugumi-electron typecheck
git diff --check
```
