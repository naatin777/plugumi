---
type: decision
title: 動的Tool pathではなくstructured targetでoperationを振り分ける
description: project / account / environment / hostをstructured contextとして扱い、dynamic path segmentではなくstructured invocation contextとresource refでroutingする方針を記録する。
status: deprecated
relations:
  architecture:
    - '00003'
  requirement:
    - '00004'
---

> 補足: この文書のstructured target object案は、[Decision 00024](00024-operation-invocation-context-and-execution.md)でinvocation contextとresource ref中心の自動解決へ置き換えた。dynamic pathを避ける方向と、暗黙に選ばない方向は00024にも引き継ぐ。

## コンテキスト

`standard` やElectron appが登録するoperationが複数あると、どの環境・どのHostへoperationを送るかを決める必要がある。会話では `standard/{project}/files/create` や `electron/{account}/browser/click` のように、projectやaccountをpathへ入れる案が出た。

しかし、project、account、environment、hostは独立した軸である。同じprojectをlocalとWSLで開くこと、同じaccountを複数Electron hostで使うこと、projectごとにdefault account / profileを持つことがある。1本のdynamic pathに埋め込むと、これらの軸を表しにくい。

## 決定

- project、account、environment、host、profileをstructured invocation contextとして扱う。
- operation名は `standard` や `electron` のような実装名ではなく、`filesystem/create` や `hostBrowser/click` のような意味単位にする。
- project IDやaccount IDなどの動的な識別子をcanonicalなoperation pathへ埋め込まない。
- invocationは `operation`、`target` / `context`、`input` を分ける。
- factory operationではtargetを指定する。instance operationでは、返されたresource refが所属先を持つため、原則としてresource refでroutingする。
- projectはdefault bindingを持てる。例えばdefault environment、browser profile、git accountをprojectへ紐付けられる。
- targetが曖昧なときは暗黙に選ばず、ambiguous errorまたはchooserへ戻す。
- 人間やAIへ見せる表示名として `filesystem/create @ project:plugumi @ env:wsl` のような表記を使ってよい。ただし、それはcanonicalなTool名ではなくcontext付きの表示名またはpreset名とする。

例:

```jsonc
{
  "operation": "filesystem/create",
  "target": {
    "project": "project/plugumi",
    "environment": "env/local"
  },
  "input": {
    "parentPath": "src",
    "name": "foo.ts"
  }
}
```

```jsonc
{
  "operation": "hostBrowser/openPage",
  "target": {
    "host": "host/electron-1",
    "profile": "browser-profile/work"
  },
  "input": {
    "url": "https://example.com"
  }
}
```

返されたpageを操作するときは、原則としてresource refだけでroutingできる。

```jsonc
{
  "operation": "hostBrowser/click",
  "input": {
    "page": "browser/page/123",
    "selector": "#submit"
  }
}
```

## target resolutionの優先順位

1. instance operationならresource refから判断する。
2. 呼び出し時に明示されたtargetを使う。
3. 呼び出し元のPanel / Execution / Workbench contextから継承する。
4. 現在のprojectのdefault bindingを使う。
5. 利用者のglobal defaultを使う。
6. それでも複数あるならambiguous errorまたはchooserへ戻す。

## 代替案

| 案 | 採らない理由 |
|---|---|
| `standard/{project}/files/create` のようなdynamic path | project / environment / host / accountの独立した軸を1本の文字列へ潰す。Tool数も動的に増える |
| `electron/{account}/browser/click` のような実装名入りpath | `electron` や `standard` はoperationの意味ではなく実装・提供元の名前である。Provider replacementと相性が悪い |
| 現在のUIやprojectから完全に暗黙推測する | 複数host・複数環境があるときに意図しない対象へ操作が行く。AI操作では特に危険である |
| resource refを使わず毎回project / accountを指定する | pageやfileなどのinstanceが所属先を持つので冗長である。参照が矛盾する可能性がある |

## トレードオフと帰結

- AIへ見せるTool数をoperation意味単位に保てる。一方で、利用可能なtargetをAIやUIへ提示する仕組みが必要になる。
- structured targetは権限判定とExecution記録に使える。例えばproject、environment、host、accountをExecutionへ記録できる。
- dynamic pathに比べてschemaとcontext modelの設計が必要になる。targetの型、表示名、省略時の規則をcontractまたはdesignで定める必要がある。
- 再検討のきっかけ: LLM tool interfaceがstructured inputよりdynamic tool名を強く好むことが実測で分かったとき。ただし、その場合もcanonical modelとは別のgenerated aliasに留める。

## 未解決の問い

- `account` がPlugumiの利用者account、external serviceのaccount、browser profileのどれを指すか。必要に応じて型を分ける。
- 複数のElectron hostが同じaccount / profileを使えるとき、host選択をproject defaultと明示指定のどちらへ寄せるか。
- target候補をAIやUIへどう列挙し、省略時にどこまで表示するか。
- targetの構造をwire contractへ入れるか、operationごとのinputへ入れるか。
