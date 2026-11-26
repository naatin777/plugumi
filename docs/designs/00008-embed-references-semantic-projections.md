---
type: design
title: Embed Referenceとvirtual embed・意味投影によるHostごとのUI解決
description: Embed参照、virtual embed、declarative / custom component representation、Interaction / Affordanceによるmachine-facingな意味投影を定める検討案。
status: draft
relations:
  requirement:
    - '00004'
  architecture:
    - '00003'
  design:
    - '00006'
  decision:
    - '00016'
    - '00020'
---

## 対応するrequirement

[Requirement 00004](../requirements/00004-common-protocol-contracts.md)は、Panel・Embed・表示・操作の連携を通じて人間がPluginの機能や結果を利用できる仕組みを求めている。また、人間とAIがそれぞれに適した方法で同じ意味へアクセスできることを求めている。このdesignは、Embedの表現、Hostごとの解決、machine-facingな意味投影を定める検討案である。

## モデル

Panelと同様に、Embedでも参照と実体を分ける。

| 概念 | 意味 |
|---|---|
| Embed Reference | 共有・保存できるEmbedへの参照。resource、intent、representation、寿命などを持つ |
| virtual embed | 表示可能でも、まだmountしていないinertな状態 |
| mounted embed | 実際にcomponent treeやcustom componentが動いている状態 |
| unavailable embed | 現在のHostでは表示できるrepresentationがない状態 |
| representation | declarative surface、custom component、view moduleなどの表現 |
| surface state | component tree、data model、revisionなどの表示状態 |
| Interaction | 人間またはAgentの入力を待っている第一級の対象 |
| Affordance | resource / executionに対して現在利用できる操作 |

virtual embedはDOM、event listener、timer、background処理を持たない。見えていないEmbedを裏で動かすのではなく、inertな参照だけを保持する。

## virtual embedが必要な理由

virtual embedには2つの動機がある。

1. UI App operationが違うため、同じEmbedでも表示できるrepresentationがHostごとに変わる。
2. chat、timeline、historyに多数のEmbedがあると、全部を同時にmountするのは重い。

したがって、表示可能かどうかと、実際にmountするかどうかを分ける。

| 状態 | 意味 |
|---|---|
| supported / virtual | このHostで表示できるが、まだmountしていない |
| mounted | 現在のHostで描画中である |
| unsupported / unavailable | このHostで表示できるrepresentationがない |

## representationの解決

Embed Referenceは、同じresource / intentに対して複数のrepresentationを持ち得る。

例えば、概念的には次のようになる。

```jsonc
{
  "id": "embed/900",
  "resource": "change/123",
  "intent": "review",
  "representations": [
    {
      "kind": "component",
      "component": "plugumi/diff-viewer",
      "priority": "preferred"
    },
    {
      "kind": "declarative",
      "template": "plugumi/diff-summary",
      "priority": "fallback"
    }
  ]
}
```

これはwire formatではなくモデル例である。重要なのは、rich representationとfallback representationを同じ意味へ紐付けることである。

Hostは次のように解決する。

1. resource + intentからrepresentation候補を探す。
2. preferred representationが現在のHostで使えるか確認する。
3. custom componentならcatalogとimplementation registryから実装を解決する。
4. 使えなければdeclarative fallbackやcontrol-only representationを試す。
5. どれも使えなければunavailable embedを表示する。

declarative surfaceはportable baselineとする。JS moduleやnative componentはenhanced representationとする。fallbackを「低級な別物」ではなく、同じ意味操作を保つ表示として扱う。

## component treeとcustom component

A2UI-likeなcomponent treeでは、basic componentとcustom componentを混ぜられる。例えば、次のような構成を取れる。

```text
Column
├── Text("3件のファイルを変更しました")
├── DiffViewer(resource=change/123)
└── Row
    ├── Button("変更を適用")
    └── Button("却下")
```

`DiffViewer` の内部はJSで実装してよい。ただし、component treeの外から見えるprops、data binding、actionはcatalogで検証できるようにする。

JSを文字列として送ってevalしない。custom componentの実装は、versionedなassetまたは登録済みmoduleとして参照する。

## surface stateと再同期

A2UI-likeなmessage streamだけをEmbedの正本にしない。UIが閉じたり別Hostへ移ったりしたときに復元できるよう、surface stateをsnapshot可能な対象として扱う。

surface stateは少なくとも次を持ち得る。

- component treeまたはtemplate参照
- data model
- revision
- owner execution / resource / interaction
- catalog / version
- lifetime

Hostはsnapshotを取得し、その後の更新eventを購読する。取りこぼした場合はsnapshotから再同期する。直接のstreamだけに依存しない。

form入力や選択状態をsurface stateへ保存するかは、用途と機微度に依存する。secretやcredentialはsurface data modelへ入れない。詳細は後述する。

## machine-facingな意味投影

AIはcomponent treeを読んで意味を推測しない。人間向けの表示とは別に、machine-facingな意味投影を提供する。

```text
同じResource / Execution / Interaction状態
├── machine-facing projection
│   └── operation / affordance / input schema / state
└── human-facing projection
    └── declarative component / custom component / native component
```

AIは通常、左側を見る。人間は右側を見る。componentはoperationの正本ではない。

### Interaction

Interactionは、人間またはAgentの入力を待っている対象である。

```jsonc
{
  "id": "interaction/901",
  "kind": "confirmation",
  "state": "pending",
  "resource": "change/123",
  "actions": [
    {
      "id": "apply",
      "kind": "operation",
      "operation": "change/apply"
    },
    {
      "id": "reject",
      "kind": "operation",
      "operation": "change/reject"
    }
  ]
}
```

Interactionが第一級なら、AIはcomponent treeを解析しなくても、何がpendingで何を選べるかを把握できる。人間側のWorkbench shellも、pending interactionからbadge、notification、attention requiredを出せる。

### Affordance

Affordanceは、resource / executionに対して現在利用できる操作である。例えば、実行中のExecutionには `cancel` が使え、完了後には `retry` が使える、という状態を表す。

operationが存在することと、現在の状態で有効であることは別である。Affordanceはこの差を表す。

## actionの種類

UI上のactionをすべてtool呼び出しにしない。

| 種類 | 例 | 扱い |
|---|---|---|
| local UI action | expand、collapse、scroll、focus、tab切替 | renderer内で処理する |
| operation action | apply、reject、cancel、save、open | Core経由のoperation / tool呼び出しにする |
| intent event | `この方針で進めて`、`この候補で修正して` | Agentまたはbackendへの意味eventにする |

componentのclickは、AI向けのoperationそのものではない。人間がbuttonを押した結果としてoperationが呼ばれてよいが、AIは通常、UI componentを経由せず同じoperationを呼ぶ。

## tool resultと表示

tool resultはcomponent treeそのものではなく、structured data、resource / artifact ref、affordance、必要に応じたpresentation hintを返す。

```jsonc
{
  "resource": "diff/123",
  "affordances": [
    "resource/open",
    "diff/approve",
    "diff/reject"
  ],
  "presentationHint": {
    "intent": "review",
    "preferredRepresentation": "diff"
  }
}
```

Hostはこれを見て、inline embed、panel、notification、または非表示を選ぶ。AIはcomponentを知らなくても、返されたresourceと次に可能な操作を把握できる。

toolとcomponentを直接1:1で固定しない。基本はartifact / resource typeにrepresentationを紐付け、tool側はpreferred representation hintを足す。

## 機密入力

secretやcredentialはsurface data modelへ入れない。外部サービス認証は、可能なら既存CLI、OAuth flow、OS keychainなどへ委譲する。

例えばGitHubなら、Plugumiのformへtokenを入力させるより、`gh auth login` またはbrowser OAuth flowを使う。Embedには認証状態と次の操作だけを表示する。

Pluginが独自にsecret入力を扱う場合でも、少なくとも次を推奨または契約化する必要がある。

- secretをshared data modelへ入れない。
- secretをexecution logへ書かない。
- explicit submitまで送信しない。
- credential fieldをsensitiveとしてmarkする。

## 例: diff review

1. Agentが複数ファイルを変更し、`change/123` を作る。
2. Agentまたはbackendが `interaction/901` を作り、人間のreview待ちにする。
3. Electronではrich `DiffViewer` を使い、Webでは同じcomponentまたはdeclarative fallbackを使う。
4. 人間はdiffを見て `apply` を押す。
5. Hostは `change/apply` operationを呼ぶ。
6. AIはcomponentを見なくても、`interaction/901` とaffordanceから状態を把握できる。

## 例: 動的な確認UI

1. Agentが削除確認を動的に作る。
2. 専用componentがなくても、Text、Checkbox、Buttonでsurfaceを構成できる。
3. 人間がすぐ答えなくても、pending interactionとしてbadgeやnotificationを出せる。
4. 別Hostでも同じinteractionを表示できる。
5. secretでなければ、checkboxなどの入力をsurface stateへ保持できる。

## 未解決の問い

- Embed ReferenceとPanel Referenceを共通のView Referenceへ抽象化するか。
- surface stateの保存主体と保持期間。execution-scoped、resource-scoped、host-session、ephemeralの区分。
- representation priorityとfallback選択を誰が決めるか。
- declarative templateとcomponent tree snapshotのどちらを保存単位にするか。
- unknown componentの表示とvalidation errorの返し方。
- InteractionとAffordanceのwire model、失効、同時操作、再送。
- secret以外の入力途中状態をHost間で共有するか。
