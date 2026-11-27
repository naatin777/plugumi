---
type: decision
title: operation呼び出しをpath・context自動解決・Executionへ統一する
description: operation indirectionを採用し、toolPath分離・targetAxes・lifetime宣言・sync/async分類を廃止する。AIにはcontextを見せず、project-scoped sessionとExecutionで統一する方針を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00016'
    - '00018'
    - '00023'
---

## コンテキスト

改訂前の[Contract 00004](../contracts/00004-plugin-client-protocol.md)は、callerが `registrationId + toolPath` を直接指定してToolを呼ぶ形を取っていた。一方、operation / Execution中心のworkbenchでは、AIやUIはprovider implementationではなくoperationと実行対象を選ぶ必要がある。

ここで、`operation + target` を正本としつつ `registrationId + toolPath` もpublic APIとして残すhybrid案が出た。しかし、これは2つの呼び方を永久に保守し、provider実装を隠すというoperation indirectionの目的を弱める。移行を楽にする以上の複雑さを招くため採用しない。

## 決定

### operation pathを唯一のpublic invocation名にする

`operation` と `toolPath` を分けない。providerは登録時からoperation pathで宣言し、callerも同じpathで呼ぶ。

```jsonc
{
  "operations": [
    {
      "path": "filesystem/list",
      "inputSchema": {},
      "outputSchema": {}
    }
  ]
}
```

```jsonc
{
  "operation": "filesystem/list",
  "input": {
    "path": "src"
  }
}
```

`registrationId` はCore内部の配送先・接続管理IDとして残ってよいが、callerへ見せるcontractには出さない。direct provider invocationはpublic APIにしない。同じscopeで同じoperationを複数providerが提供した場合は、Coreが暗黙に選ばずambiguous errorまたはchooserへ戻す。providerごとに意味や挙動が違うなら、同じoperation名にしない。

operation pathは `filesystem/list` のようなslash区切りをcanonicalにする。CLI・MCP・HTTP APIとの互換はこのpathを基準にする。特定のAI providerやMCP実装がslashを扱えない場合だけ、adapterが `filesystem__list` のような安全な名前へencode/decodeする。canonical modelには別名を持たせない。

### AIにはcontextを入力させない

`input` はAIが埋めるoperation固有の引数である。`project` / `account` / `host` などのrouting情報はAIに毎回入力させず、**invocation context**としてCoreまたはagent runtimeが付与する。

AIから見える呼び出しはoperationとinputだけにする。

```ts
filesystem/list({
  path: "src"
})
```

agent runtimeからCoreへの呼び出しにはcontextが付く。

```jsonc
{
  "operation": "filesystem/list",
  "input": {
    "path": "src"
  },
  "context": {
    "project": "project/plugumi",
    "callerExecution": "execution/agent-1"
  }
}
```

AIへ送るtool schemaにはoperation inputだけを含め、context項目は含めない。CLIやMCPでも毎回のcallへtargetを書かせず、CLIはカレントディレクトリやproject設定から、MCPはproject-scopedなserver / sessionからcontextを得る。必要な場合はCLIの `--project` のようなsession / command単位のoverrideに留める。

`page` や `file` のようなresource refはrouting情報ではなく操作対象なので、operation inputに入ってよい。

```jsonc
{
  "operation": "hostBrowser/click",
  "input": {
    "page": "browser/page/123",
    "selector": "#submit"
  }
}
```

resource refが所属先を持つ場合、追加のtargetは不要である。

### context解決はCoreが行う

`target` という名前の入力項目は設けず、**context**として自動解決する。解決順は次の通り。

1. `input` 内のresource refが所属先を持っていればそれを使う
2. caller execution / agent sessionのprojectを使う
3. projectのdefault bindingを使う
4. global defaultを使う
5. それでも決まらなければambiguous errorまたはchooserへ戻す

projectは主要なcontextだが、すべてのoperationがproject-scopedとは限らない。hostやglobalな操作もあるため、public contract上も `target` へ改名するのではなく `context` と呼ぶ。

genericな `account` axisはpublic contractへ出さない。GitHub account、Slack account、browser profile、Plugumi user accountは別の概念なので、内部ではserviceごとのaccount / profile refとして扱う。

```text
account/github/work
account/github/personal
browser-profile/work
```

projectはdefault bindingを持てる。

```text
project/plugumi
  environment -> env/local
  github -> account/github/work
  browser -> browser-profile/work
```

複数accountがある場合、Coreが適当に選ばない。project default、global default、ambiguous errorまたはchooserで解決する。AIにaccountを毎回選ばせるのではなく、利用者が一度選んだ結果をproject bindingとして覚えることを優先する。

### sync / async種別を廃止し、すべてExecutionにする

operation登録の `sync` / `async` 種別は持たない。すべてのoperation invocationはCoreが管理するExecutionを作る。fastなoperationは、最初からterminal状態のExecutionになるだけである。

```jsonc
{
  "execution": {
    "id": "execution/123",
    "operation": "filesystem/list",
    "status": "succeeded",
    "result": {
      "entries": []
    }
  }
}
```

長時間のoperationは最初はrunningである。

```jsonc
{
  "execution": {
    "id": "execution/124",
    "operation": "shell/exec",
    "status": "running"
  }
}
```

terminal状態は `succeeded` / `failed` / `cancelled`、非終了は `running` などのstatusで表す。別途 `done` フラグを必須にはしない。streaming outputもExecutionに紐付ける。

AIへは毎回非同期の形で見せなくてよい。agent runtimeが短時間待ち、終了していれば通常のtool resultとしてresultを返し、終了していなければexecution refと状態を返す。これはCoreのcontractではなくagent runtimeの待機・表示ポリシーである。

### provider descriptorからtargetAxesとlifetimeを外す

`targetAxes` はproviderごとに宣言しない。target / contextの意味はoperation定義側が持ち、providerは自分が属するscopeを持つ。例えばEnvironment Providerは `env/local`、Electron appが登録するoperationは `host/electron-1` に属する。Coreはcontextからscopeを解決し、そのscopeでoperationを実装するproviderを選ぶ。

`lifetime` もproviderがoperationごとに自己申告する項目にはしない。Coreがprovider sessionの種類から導出する。

- daemon-managed / external service provider → durable
- hostから接続されたUI Appのprovider → host-session
- Workbench UI内だけのもの → ui-session

AIへ見せるcatalogには、この寿命をderived metadataとして表示してよい。ただしwire contractやprovider宣言の必須項目にはしない。

## 例

GitHub operationをAIが呼ぶ場合、AIはissueの内容だけを入力する。

```ts
github/createIssue({
  title: "bug report",
  body: "..."
})
```

Coreはcaller executionのprojectを見て、`project/plugumi -> account/github/work` のbindingからaccountを解決する。bindingが無く複数accountがある場合は、勝手に選ばずambiguous errorまたはchooserへ戻す。

## 代替案

| 案 | 採らない理由 |
|---|---|
| `operation + target` と `registrationId + toolPath` の両方をpublic APIにする | 2つの呼び方を永久に保守し、provider implementationを隠す目的が弱まる。AIへ見せる面も複雑になる |
| provider登録の `toolPath` とsemantic `operation` を分ける | 同じものに2つの名前が生まれ、対応表と変換規則が必要になる。CLI / MCP / AIでcanonical名がぶれる |
| project / environment / host / accountを持つstructured target objectをcallerへ入力させる | 多くの呼び出しでは不要で、AIが誤った対象を選ぶ危険がある。必要な情報はsession / project binding / resource refから解決できる |
| provider descriptorに `targetAxes` を持たせる | 同じoperationなのにproviderごとにtargetの意味が変わりうる。targetの意味はoperation定義側が持つべきである |
| provider descriptorに `lifetime` を持たせる | 寿命はprovider sessionの事実であり、operationごとの自己申告ではない。Coreが導出できる |
| operationに `sync` / `async` 種別を持たせる | 実際の所要時間や中断可否はoperation宣言だけでは決まらない。Executionで統一した方がcancel / progress / result参照をuniformにできる |

## トレードオフと帰結

- [Decision 00018](00018-operation-targeting-context.md)のstructured target object案は、このdecisionのinvocation contextとresource ref中心の解決へ置き換える。dynamic pathを避ける方向と、暗黙推測を避ける方向は維持する。
- Contract 00004は `registrationId + toolPath` をcaller contractから外し、operation invocationとExecutionを正本に据えるよう改訂した。次はCore・Provider・UI App実装をこのcontractへ移行し、縦切りで検証する必要がある。
- contextを自動解決する分、ambiguous errorとchooserのUXが重要になる。Coreは黙ってproviderやaccountを選んではいけない。
- すべての呼び出しがExecutionになるため、fastなoperationではExecution recordを軽量に保つ実装が必要になる。永続化範囲や保存期間は別途決める。
- compositeなproject×environmentが必要になった場合は、target axisをcallerへ開くのではなく、binding resourceとして表す方向を先に検討する。
