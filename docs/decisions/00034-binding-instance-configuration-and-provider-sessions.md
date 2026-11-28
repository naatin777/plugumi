---
type: decision
title: bindingを部分適用として扱い、account差はinstance configurationとする
description: bindingをoperationの部分適用として定義し、fixed / defaultとvisibilityを分け、accountなどのinstance差はinputではなくinstance configurationとし、1 processが複数provider sessionを登録できる方針を記録する。
status: draft
relations:
  architecture:
    - '00003'
  decision:
    - '00031'
    - '00032'
---

## コンテキスト

複数account、複数session、複数同種pluginをCoreがどう振り分けるかを検討する中で、accountをoperation pathやinputに入れる案が出た。しかし、REST / OWASPのmulti-tenant設計では「誰として操作するか」はactorのidentityであり、対象を指すpathやinputとは別の層（credential選択）として扱われる。`gh issue create` に `--account` がなく、`gh auth switch` がtokenを切り替えるだけなのと同じである。

また、bindingはあらかじめ検討されていた高階関数 / 部分適用のモデルと一致し、object capability securityでいうattenuated facet（制限したwrapperを渡すこと自体がpolicyの表現）に相当する。AIが混乱せず、コンテキストを無駄にしないtool表面を作るには、bindingとtool投影の関係を明確にする必要があった。

## 決定

### bindingはoperationの部分適用

bindingはoperationの部分適用として定義する。inputの一部を固定または既定値として埋めたもので、設定レイヤーとして重ねられる。

```text
ユーザー全体
  ↓ 上書き
project
  ↓ 上書き
agent session
  ↓ 上書き
呼び出し時の指定
```

routing系（project root、environmentなど）と挙動系（read上限サイズなど）を分けず、どちらも「operationのinputに対する既定 / 固定の設定」として扱う。

### fixed / defaultとvisibilityは直交

| 種類 | callerから | 用途 |
|---|---|---|
| fixed + hidden | 存在すら見えない | attenuation。触らせたくないもの |
| fixed + visible | 値は見えるが変更不可 | callerが文脈を知る必要がある場合。「work accountとして動いている」をAIが知るなど |
| default | 見えるし上書きできる | 普通の既定値 |

fixedをcallerが上書きしようとした場合はerrorとし、黙って変えない。fixedを埋めるのは人間とは限らず、tool投影を生成する側がschema整形として使う場合もある。fixedはセキュリティ境界の場合と、単なるschema整形の場合の両方を同じ仕組みで表す。

### accountなどのinstance差はinputではなくinstance configuration

accountのような差はoperation inputやpathではなく、provider instanceのconfigurationとする。1つのinstanceは1つの設定済みの器であり、credentialはinstanceが持つ。selectorをinputに入れない。

```text
GitHub plugin instance（work用に設定済み）
GitHub plugin instance（personal用に設定済み）
```

このため、AIのinputにaccountは現れず、「どのaccountか」の選択はinstance選択、すなわちCoreのroutingとbindingの問題になる。

### 1 processが複数のprovider sessionを登録できる

processとprovider sessionを分離する。1つのPlugin runtime processが、設定の異なる複数のprovider sessionをCoreへ登録してよい。

```text
GitHub plugin runtime process（1つ）
  ├── provider session: github/work
  └── provider session: github/personal
```

Coreから見れば独立したproviderであり、scope / bindingで振り分けられる。process効率とroutingの分離を両立する。provider sessionが持つ設定をCoreがinvocationと一緒に送るか、plugin側が保持するかは実装の詳細とする。

### discoveryは普通のoperation

account list、project list、terminal listなどのdiscoveryは特別な仕組みにせず普通のoperationとする。AIは必要なときだけ呼び、返ってきた値をinputに使う。schemaに一覧を埋め込まない。

### AI向けtool表面はbindingで最小化する

AIが混乱せずコンテキストを無駄にしないため、tool投影はbinding適用後の姿にする。

- fixed + hiddenな項目はschemaから消える
- 選択肢が少ないものはenumで見せる
- 動的で数が多いものはdiscovery operationで取りに行く

### 解決結果はExecutionに記録する

Coreはbinding（設定レイヤー）をマージして最終inputとscopeを確定し、providerへ配送し、解決済みの内容をExecutionに記録する。「なぜそのaccount / 環境に行ったか」をあとからinspectできるようにする。曖昧な場合はCoreが適当に選ばずerrorにする方向は[Decision 00032](00032-routing-and-provider-lifecycle-notes.md)の通り。

## 帰結

- `github/{account}/issue/create` のようなactor identityのpath埋め込みは行わない。対象のowner / repoなどはinputでよい
- credential選択はinputではなくinstance configurationに倒れるため、Coreがaccountの意味を知る必要はほぼない
- bindingはpermissionと一体の概念であり、attenuated facetの鋳造として扱える
- tool投影（[Decision 00031](00031-operation-schemas-streams-and-routing.md)）は、binding適用後のoperationをcaller向けに名前付きで公開したものとして定義できる

## 追加の決定

- binding entryの正本とagent sessionのbindingは、後々agent pluginが管理する方向とする。Coreが全bindingを集中管理しない
- provider sessionの設定はplugin側が保持する。credentialやaccount identityはCoreを通さず、sessionごとにplugin内へ閉じる。Coreが持つのは複数の同一plugin sessionを振り分けるためのrouting情報と、project周りのbindingである
- bindingの入れ子は強める方向のみを推奨とする。attenuationの原則に従い、下位レイヤーは上位のbindingを緩めない。推奨レベルであり、強制ルールとして実装で禁止するかは別途決める

## 未解決の問い

- binding entryの具体的な保存形式。正本はagent plugin方向だが、Project registryとの関係は要検討
- fixed+visibleの値をschemaの `const` で表すか、説明文で表すか
