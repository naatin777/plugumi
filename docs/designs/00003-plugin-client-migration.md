---
type: design
title: 現行試作からProvider接続・operation / Executionへの移行
description: registrationId + toolPath / tools.callの現行実装を、Provider接続とoperation invocation / Execution modelへ移す順序と合格条件を定める。
status: draft
relations:
  requirement:
    - '00002'
    - '00003'
    - '00004'
    - '00005'
  architecture:
    - '00003'
  decision:
    - '00012'
    - '00016'
    - '00019'
    - '00024'
    - '00027'
  contract:
    - '00004'
  verification:
    - '00002'
---

## 対応するrequirement

[Requirement 00003](../requirements/00003-plugin-ecosystem-support.md)はPlugin開発・採用環境を求め、[Requirement 00004](../requirements/00004-common-protocol-contracts.md)はoperation呼び出し・実行状態・通知を扱う共通契約を求めている。このdesignは、現行実装を[Architecture 00003](../architecture/00003-daemon-centric-workbench-platform.md)と[Contract 00004](../contracts/00004-plugin-client-protocol.md)へ寄せる順序を定める。

## 現行実装の位置づけ（2026-11-26時点）

ProviderがCoreへ登録・接続する方向自体は、旧revisionの `registrationId + toolPath` modelで試作済みである。Core 2台への接続、SSE、再接続、途中出力、取消の一部は[Verification 00002](../verification/00002-plugin-client-conformance.md)に記録されている。

一方で、少なくとも `core/internal`、`environment/src`、`apps/web/internal`、`packages/plugin-client`、`plugins/agent` には `toolPath` / `tools.call` / `sync` / `async` のmodelが残っている。Contract 00004のoperation invocation / Execution modelは、まだ実装へ十分に反映されていない。

`packages/plugin-client` は現行のTypeScript / Node.js向け接続実装だが、Core接続、Tool dispatch、UI bundle読込、process recordが混在したlegacyである。新しいclient libraryへ責務を分けて置き換える（[Decision 00027](../decisions/00027-client-library-languages-and-framework-bindings.md)）。

## 位置づけ

この文書は実装着手の承認ではなく、議論を進めるための移行順の検討案である。operation / Execution、lifecycle、client library、UI App operationの個別論点がまだ残っているため、この順序をそのまま実装計画として確定しない。

## 移行の原則

- 縦切りで移行する。Coreだけ、UIだけを先に新contractへ見せかけて終わらせない。
- 開発中の旧 `/v1/` と互換を保たない。旧 `registrationId + toolPath` caller contractと新しいoperation invocationを恒久的に併用しない。
- transport移行とprocess lifecycle移行を分ける。ProviderがCoreへ接続する方向は変えず、operation / Executionとmanaged lifecycleを別段階で実装する。
- 名称変更だけの大規模rewriteをしない。実装の移行に合わせて責務ごとに分解する。
- 旧revisionで通った検証は、operation / Execution modelへそのまま転用しない。同じ観点を新しいcontractで再検証する。

## 段階と合格条件

| 段階 | 変更順・範囲 | 次へ進む条件 |
|---|---|---|
| 1. Coreのoperation / Execution化 | Coreでoperation宣言、operation catalog、context解決、`operations.invoke`、Execution record / event / cancelを実装する。テスト用の小さなProviderでechoを通す。 | `operations.invoke` がterminal状態のExecutionを返す。running実行のevent、cancel、provider切断時の `failed` / `unknown` を観測できる。 |
| 2. TypeScript client libraryとagentの移行 | `packages/plugin-client` を直接renameせず、Core接続 / RPC / operation dispatch / UI bundle登録の責務を持つ新しいTypeScript / Node.js向けlibraryへ分解する。agent pluginを最初の利用者にする。 | agentが `tools.call` を使わずoperationを登録・実行できる。複数Coreで登録、event、cancelが混ざらない。 |
| 3. Environment Providerの移行 | RustのEnvironment Providerをoperation / Execution modelへ移す。filesystem / shell / processなどbuilt-in environment operationをsemanticなoperation pathで登録する。 | 代表operationがUI非依存のExecutionとして動く。long-running shell / terminal相当の処理をUIのcloseなしで継続できる。 |
| 4. Web app / Electron appの移行 | Web appのcaller経路、Panelからの呼び出し、Electron appのUI App operation登録をoperation / Execution modelへ移す。`callTool` / `toolPath` をPanel contractから外す。 | UI AppがExecutionを開始・購読・一覧・cancelできる。UIを閉じてもdurable Executionが残り、host-session operationは例外として扱える。 |
| 5. lifecycle / Daemon managementの実装 | Core Daemonのlocal process manager、Daemon management API、Plugumi管理のPlugin runtime processのenable / disable / stop、remote-side supervisorへの委譲契約を実装する。`plugumi` CLIとUI Appを操作面として接続する。 | UI AppとCLIがPlugin runtime processを直接所有せずにPluginをenable / disableできる。localとremoteでspawn主体が分かれていることを観測できる。 |
| 6. legacyの除去とdocs確定 | 旧 `tools.call`、旧caller contract、`registrationId + toolPath` caller指定、legacy `packages/plugin-client` を消す。Verification 00002を新contractで再実行し、結果を更新する。 | 旧method / fieldが実装から除去される。新しい適合シナリオが通り、glossaryの旧用語が実装読解用の歴史語だけになる。 |

## 移行順の理由

最初にCoreへExecutionを置くのは、UI非依存の実行とcancel / subscribeの正本がCoreだからである。UIやProviderを先に変えると、実行状態の所有者が分かれたままになる。

TypeScript libraryを先に作るのは、agentが最初の利用者であり、WebSocket RPC、reconnect、operation dispatch、cancelを各Pluginへ分散させないためである。Environment ProviderはRust実装だが、built-in operationとして重要なので、TypeScript側の縦切りが通った後に続けて移行する。

Web app / Electron appはcallerとUI App operationの両方を持つため、Provider側のoperation modelが動いてから移行する。lifecycle / Daemon managementは、operation / Executionがない状態で作るとprocess管理だけが先行し、実行状態と結び付かないため後段に置く。

## 未解決の問い

- 新しいTypeScript / Node.js向けlibraryのpackage名と責務分割。
- Rust向けclient libraryをどこまで共通化するか。最初はEnvironment Provider内の実装で十分かを検証する。
- Execution recordの永続化範囲、保存期間、Core再起動後の復元範囲。
- remote-side supervisorへ起動・停止を委譲するwire contract。Environment Providerが持つ範囲と外部systemに任せる範囲。
- Panel専用APIとoperation catalogの権限分離をどう実装へ落とすか。
- UI App operationのhost-session終了時に、running Executionを `failed` / `cancelled` / `unknown` のどれへ進めるか。

## 検証への示唆

各段階は[Verification 00002](../verification/00002-plugin-client-conformance.md)の対応するシナリオで確認する。特にC2（登録と期限）、C4（複数Core）、C5（RPC障害）、C7（Bundle・Panel）は、段階2〜4の合格条件に直結する。段階5のlifecycle検証は、現行のVerification 00002だけでは足りないため、Daemon managementとPlugumi管理のPlugin runtime processのシナリオを追加する必要がある。
