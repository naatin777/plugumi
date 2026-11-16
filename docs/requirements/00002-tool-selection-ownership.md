---
type: requirement
title: Tool選択は呼び出し元Pluginの責務
description: CoreはToolの登録・検索・実行を担い、どのToolを使うかの判断は呼び出し元Pluginに委譲する。
status: draft
relations:
  goal:
    - '00003'
---

## コンテキスト

同一Pluginの複数登録・複数Nodeにより、同名・同機能のTool候補が複数存在し得る。どれを呼ぶかの判断基準は利用側の文脈（ユーザーのNode、既定、用途）に依存するため、Coreに置くと業務判断が汎用プラットフォーム層へ漏れ出す。

この境界は旧実装からの継続でもある: CoreはAI非依存であり、Toolのフィルタリングは呼び出し元Pluginの責務とされてきた。

## 要求事項

- CoreはToolの登録・検索・呼び出しの転送・実行時の権限検証を担う MUST
- Coreは候補を勝手に選択してはならない MUST NOT
- Tool呼び出しは `linkId + toolPath` による厳格指定でなければならない MUST
- 呼び出し元Pluginは、候補のフィルタリング・Default管理・選択View・単発/複数実行の判断を自前で行う MUST
- Discoveryは Tag + Input Schema + Output Schema で検索できなければならない MUST
- Discovery結果は基本的に `linkId + toolPath` のみとする SHOULD（Node等の追加情報は必要時に別APIから取得）

## 受入基準

```text
Tool Discovery（Tag + Input/Output Schema）
    ↓
候補一覧（linkId + toolPath）
    ↓
呼び出し元Pluginがフィルタリング・選択
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
