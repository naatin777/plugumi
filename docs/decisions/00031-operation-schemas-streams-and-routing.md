---
type: decision
title: operation schemaをinput / accept / stream / resultに分け、Eventを独立概念にしない
description: sync / asyncを廃止したExecution modelにおける4種類のschema、購読の扱い、用語整理、Resourceとroutingの未決論点を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00024'
    - '00030'
  contract:
    - '00004'
---

## コンテキスト

旧Tool modelは `sync` / `async` をoperation宣言の種別とし、async toolは途中出力を持てた。operation / Execution modelへ移すと、速い処理、長時間処理、購読の違いを `sync` / `async` の2分類で表せないことが分かった。

あわせて、AI向けtool、CLI、MCP、Code Modeで共通に使うoperation schemaを考えると、最終結果だけでなく、受理時に返す参照や開始確認も必要になる。一方、Eventなどを独立した第一級概念にすると、用語と登録対象が増えすぎる。

## 決定

### operationのschemaは4種類に分ける

operation宣言では、少なくとも次のschemaを区別する。

| schema | 意味 |
|---|---|
| `inputSchema` | operationを呼ぶときの引数 |
| `acceptSchema` | 受理・開始時に返るoperation固有のデータ。session ref、page ref、購読受理結果、開始した対象の参照など |
| `streamSchema` | 実行中に0回以上流れるchunk / progress / logなど |
| `resultSchema` | terminal状態で返る最終結果 |

`outputSchema` という曖昧な名前は使わない。`executionId`、`status`、時刻、contextなどはExecution envelopeの共通fieldであり、`acceptSchema` には入れない。速いoperationでは `accept` を省略または空にし、最初からterminal状態の `result` を返してよい。長時間のoperationでは `accept` にsession refやresource refを含めてよい。

`accept` / `stream` / `result` の正確なwire field名と、schema検証をどこまでCoreが行うかは、contract revisionを切るときに確定する。

### sync / async種別を持たない

operation宣言に `sync` / `async` は持たない。すべてのoperation invocationはExecutionを作る。速いoperationは最初からterminal状態のExecutionになり、長時間のoperationはrunningで返る。`done` フラグは持たず、終了は `succeeded` / `failed` / `cancelled` などのstatusで表す。

### wire種別とcaller向けprofileを分ける

`sync` / `async` をCore / wire contract上の種別として復活させないことは維持する。ただし、AI / Code Mode / CLIがoperationをどう呼び、結果をどう受け取ればよいかを知るため、caller向けの分類は必要である。これは正しさの保証ではなく、catalogや型生成のためのmetadataとして扱う。

候補は次の3分類である。

| profile | 意味 |
|---|---|
| `immediate` | 通常はすぐ `result` が返る操作 |
| `execution` | `accept` / `stream` / `result` を持ち得る有限の実行 |
| `subscription` | cancelするまで `stream` が続く可能性がある購読。意味のある最終 `result` を返さなくてよい |

このprofileは、まずschemaの有無から推測する。

| schemaの組み合わせ | だいたいの意味 |
|---|---|
| `input + result`だけ | `immediate`っぽい |
| `input + accept + result` | 有限の長時間実行っぽい |
| `input + accept + stream` | `subscription`っぽい |
| `input + accept + stream + result` | stream付きの有限実行っぽい |

ただし、これは可能性の推測であり保証ではない。例えば`input + result`だけのoperationでも、network環境によっては長時間終わらないことがある。Coreのcontract上は常にExecutionとして扱い、profileはAI / Code Mode / CLI向けのwrapperや型生成にだけ使う。明示的なprofile metadataをoperation宣言へ追加するかは未決定とする。

### Eventは独立した第一級概念にしない

EventをResourceやExecutionと並ぶ独立概念としては扱わない。実行中の出力や状態変化は、まずExecutionのstream outputとして扱う。購読や継続出力も、専用のEvent subscription mechanismを最初から作らず、終わらないまたは長時間runningのExecutionとして表せるかを優先して検討する。

Executionそのものの状態を外部へ通知するためのwire通知は必要に応じて存在してよいが、それは概念上の第一級Eventモデルを意味しない。

### capabilityを正式用語にしない

capabilityはPlugin IDでもoperationの実体でもなく、現行の正式用語としては使わない。`filesystem/*`、`terminal/*`、`github/*` のようなoperation pathのまとまりを人間が理解する必要がある場合は、capabilityと名付けず「機能領域」「operation group」などと普通に説明する。専用の登録APIやregistryは設けない。

### Operationは旧toolPathの後継

Operationは旧 `toolPath` の後継であり、Plugin内部のローカルIDではなく、callerから見える意味付きのcanonicalな操作名とする。callerはproviderやregistrationを直接選ばず、operation pathとinputを指定し、Coreがcontextやresource refから振り分ける。

## Resourceとbindに関する整理

Resourceの厳密な定義はまだ確定しない。ただし、次の用語は分ける。

| 用語 | 意味 |
|---|---|
| Resource本体 | terminal、browser page、agent sessionなど、実際に状態を持つ対象 |
| resource ref | `terminal/123` のような、Resource本体を指すwire上の参照 |
| Resource registry | CoreがResourceの一覧や所属先を管理する仕組み。導入するかは未決定 |

Resourceを「複数のoperationをまたぐ状態物」に狭める案は保留する。ただし、terminal / browser page / agent sessionなどはinputにIDを入れるだけでも、意味的にはresource refとして扱える。CoreがすべてのResource本体を管理する必要はない。

`bind` という語も1つの概念として確定しない。少なくとも次の3つを分けて考える。

| 種類 | 目的 |
|---|---|
| 接続・振り分けbind | どのprovider session / Environment / accountへoperationを送るか決める |
| Project bind | Projectが使うenvironment、folder、account、profileなどの既定を決める |
| Input bind | operation inputの一部を固定・隠蔽・既定値化し、AI / CLI / MCP / Code Modeへ公開する形を変える |

Input bindはCode Mode専用の機能にしない。AI function calling、CLI、MCP、Code Modeで共通に使えるPlugumi側の機構として検討する。

## Project routingに関するメモ

過去の議論では、AIが複数Projectを扱うため次の方向が検討されていた。

- AIへ `projects.list` を見せ、利用可能なProjectを分かるようにする
- Projectは少なくともenvironment / nodeとroot folderを持つ
- AIには絶対パスではなくProject内の相対パスを使わせる
- operation呼び出し時にProjectから適切なEnvironment / providerへroutingする
- root boundaryの強制はcaller側ではなくEnvironment / provider側で行う
- 現在のProjectはagent sessionやinvocation contextに持たせ、特定の呼び出しだけ明示的に別Projectへ変えられるようにする

この方向は [Decision 00030](00030-environment-and-project-model.md) の「ProjectはEnvironment上のdevice / folderを指す」という整理と整合する。ただし、Project registryをCoreが持つのか、別provider / pluginが持つのかは未決定である。

また、過去の議論で `Workspace` はworktree /作業ディレクトリの意味で使われていたが、現行の画面モデルではWorkspaceはPanelとtab構成をまとめる単位である。語が衝突するため、過去の記述を読むときは混同しない。作業ディレクトリ側の意味が必要な場合は、今後 `worktree`、`checkout`、または別の語で検討する。

## 未解決の問い

- 複数の同じPlugin / providerが登録されたとき、Coreがどこまでrouting責任を持つか
- 1つのPlugin runtimeが内部で複数account / projectを扱う場合と、複数provider sessionに分ける場合の使い分け
- Resourceを「複数のoperationをまたぐ状態物」に狭めるか
- CoreがResource registryやrouting indexを持つか
- Project registryをCoreが持つか、別provider / pluginが持つか
- `acceptSchema` / `streamSchema` / `resultSchema` のwire名と必須性
- schemaの有無から推測するだけで足りるか、明示的なcaller向けprofile metadataをoperation宣言へ持たせるか
- 購読としての長時間Executionを、通常のExecution一覧でどう扱うか
- Input bindの優先順位、上書き禁止、動的値の解決タイミング
