---
type: requirement
title: Tool選択は呼び出し元の責務
description: CoreはToolの登録・検索・実行を担い、どのToolを使うかの判断は呼び出し元に委譲する。
status: draft
relations:
  goal:
    - '00003'
---

## コンテキスト

同一Pluginの複数登録・複数Nodeにより、同名・同機能のTool候補が複数存在し得る。どれを呼ぶかの判断基準は利用側の文脈（ユーザーのNode、既定、用途）に依存するため、Coreに置くと業務判断が汎用プラットフォーム層へ漏れ出す。

この境界は旧実装からの継続でもある: CoreはAI非依存であり、Toolのフィルタリングは呼び出し元の責務とされてきた。

呼び出し元にはPluginと、TUI・UI Host・スクリプトなどの非Pluginクライアントを含む。接続や識別子のwire表現はプロトコル版の契約で定義する。

## 要求事項

- CoreはToolの登録・検索・呼び出しの転送・実行時の権限検証を担う MUST
- Coreは候補を勝手に選択してはならない MUST NOT
- Tool呼び出しは、対象Core内のPlugin登録と `toolPath` の両方を厳格に指定しなければならない MUST
- 呼び出し元は、候補のフィルタリング・Default管理・選択View・単発/複数実行の判断を自前で行う MUST
- Discoveryは Tag + Input Schema + Output Schema で検索できなければならない MUST
- Discovery結果の宛先参照は基本的にPlugin登録と `toolPath` の組とする SHOULD（Node等の追加情報は必要時に別APIから取得）

## 受入基準

```text
Tool Discovery（Tag + Input/Output Schema）
    ↓
候補一覧（Plugin登録と toolPath）
    ↓
呼び出し元がフィルタリング・選択
    ↓
厳格なTool Call
    ↓
Coreが適切なNodeへ転送・実行
```

- 同一 `toolPath` を持つ複数候補がある場合も、Coreは1つに絞らず候補を返す
- 呼び出し元が指定しない限り、Coreは候補から暗黙に1つを選ばない
- 未登録・解決不能・権限不足の呼び出しは暗黙退避せず失敗として返る

## 非目標

- Coreによる「賢い」Tool推薦・AIによる自動選択
- 呼び出し元をまたいだ選択状態の共有
