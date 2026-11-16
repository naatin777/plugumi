---
type: decision
title: "Pluginの実装言語: standard=Rust・agent=TypeScript"
description: 各Pluginの実装言語と、その選定理由（ライブラリ直結・LLMエコシステム）。
status: draft
relations:
  decision:
    - '00005'
---

## コンテキスト

`00005` でPluginを独立プロセス・任意言語で実装する方針を決めた。では各Pluginを何で書くか。

## 決定

- **standard → Rust**
- **agent → TypeScript（Node.js）**

## 理由

### standard: Rust

standard Pluginは、ファイル操作・ファイル探索・検索・置換・Terminalを提供する。

ファイル検索や置換では、外部CLIを起動して標準出力を解析する方式をできるだけ避け、ライブラリのAPIを直接利用したい。Rustにはripgrepを構成する `ignore` や `grep-searcher` などのライブラリがあり、これらを直接組み込める。また、PTYやファイル監視を扱うライブラリも利用できる。

そのためstandard PluginにはRustを採用する。主な理由は実行速度ではなく、**ライブラリを直接利用できること**と、**外部CLIの出力形式に依存しない実装を好む**ことにある。

### agent: TypeScript

Agentの主な仕事は、OSを直接操作することではなく、LLM・Tool・Context・実行状態を組み合わせてAgentの動作を制御すること。

TypeScriptを選ぶ理由:

- LLM ProviderのSDKが豊富で、複数モデルへの対応が容易
- JSON Schema、Tool入出力、Structured Outputを型と結びつけやすい
- 非同期Tool実行・Streaming・Eventとの相性がよい
- AI向けライブラリを利用し、モデル固有の通信処理を自作せずに済む
- Plugumi独自のAgent Loop、Queue、Context管理に開発時間を使える

要するに、Agentの実装言語は、OS操作の性能よりLLM関連のエコシステムを重視して選んでいる。

なお、TypeScriptを採用する理由は公式UI HostがSolidJSであることとは別。AgentのバックエンドをTypeScriptで書き、Plugin ViewをSolidJSで書く構成で問題ない。

## トレードオフと帰結

- 言語が分かれるためwire型は各Pluginが自分で持つ（共有SDKは作らない。Plugin独立の前提）
- standardの検索系toolは、今後 `ignore`/`grep-searcher`/`notify`/PTY系crateの追加を検討する（規約どおり追加時は要許可）
- agentのLLM SDK選定は `00009` に分離
