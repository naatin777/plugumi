---
type: requirement
title: operation選択とprovider routingの責務を分ける
description: 呼び出し元はsemanticなoperationとinputを選び、Coreはcontextからproviderを解決する。Coreは曖昧な候補を暗黙に選ばない。
status: draft
relations:
  goal:
    - '00003'
  decision:
    - '00024'
---

## コンテキスト

operation / Execution中心のworkbenchでは、AIやUIはprovider implementationではなくsemanticなoperationを選ぶ。一方、実際の実行にはproject、environment、host、service account / profileなどの文脈が必要になる。これを呼び出し元へ毎回入力させると、AIが誤った対象を選び、呼び出し契約も複雑になる。

したがって、operation選択とprovider routingを分ける。callerはoperationとinputを選び、Coreはinvocation context、resource ref、project bindingからproviderを解決する。Coreは便利さのために曖昧な候補を黙って選んではならない。

呼び出し元にはPluginと、TUI・UI App・スクリプト・agent runtimeなどの非Pluginクライアントを含む。接続や識別子のwire表現はプロトコル版の契約で定義する。

## 要求事項

- Coreはoperation宣言・catalog・呼び出しの転送・実行時の権限検証・Execution記録を担わなければならない（MUST）
- callerはsemanticなoperation pathとoperation inputを指定しなければならない（MUST）。`registrationId` やprovider固有の宛先をpublic invocation APIで指定してはならない（MUST NOT）
- AIへ見せるtool schemaにはoperation inputだけを含めなければならない（MUST）。project・account・hostなどのcontext項目をAIへ入力させてはならない（MUST NOT）
- Coreはinput内のresource ref、invocation context、project binding、global defaultの順でscopeを解決しなければならない（MUST）
- Coreは解決したscope内で一意なproviderへ配送してよいが、複数候補または解決不能な場合に暗黙の候補選択をしてはならない（MUST NOT）。ambiguous errorまたはchooserへ戻さなければならない（MUST）
- operation catalogはpath・description・input schema・output schemaを提供しなければならない（MUST）。provider固有の宛先を含めてはならない（MUST NOT）
- 同じscopeで同じoperation pathを複数providerが提供する場合、Coreは曖昧さを呼び出し元へ返さなければならない（MUST）

## 受入基準

```text
operation catalog（path + input/output schema）
    ↓
caller / AIがoperationとinputを選択
    ↓
agent runtime / sessionがcontextを付与
    ↓
Coreがscopeとproviderを解決
    ↓
Executionとして実行・記録
```

- AIは `registrationId`、provider ID、account、hostを知らなくてもoperationを呼べる
- contextだけでは一意に決まらない呼び出しは、Coreが適当に選ばずambiguous errorになる
- 未登録・解決不能・権限不足の呼び出しは暗黙退避せず失敗として返る
- fastなoperationも含めて、呼び出し結果はExecutionとして参照できる

## 非目標

- Coreによる「賢い」operation推薦・AIによる自動選択
- provider implementationを呼び出し元へ暴露するdebug APIの標準化
- 呼び出し元をまたいだ選択状態の共有
