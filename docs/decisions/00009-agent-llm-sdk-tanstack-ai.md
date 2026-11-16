---
type: decision
title: "Agent LLM SDK候補: TanStack AI（評価中）"
description: AgentのLLM通信レイヤ候補の比較と、TanStack AIを評価する理由・採用条件。
status: draft
relations:
  decision:
    - '00008'
---

## コンテキスト

agent Plugin（TypeScript）のLLM通信レイヤを、自前実装せずSDKに任せる範囲を決める。候補は TanStack AI・Vercel AI SDK・pi-ai。

## 決定

**TanStack AI を第一候補として評価する**（確定ではない）。

ただし採用条件がある: TanStack AIのAgent Loopをそのまま使うこと自体が目的ではない。**Plugumi独自のQueue、割り込み、Tool実行、Context管理に必要な制御を本当に実現できるか**が採用条件になる。

## 比較

| 比較項目 | TanStack AI | Vercel AI SDK | pi-ai |
|---|---|---|---|
| 複数Provider | 対応 | 対応、Providerが豊富 | 対応 |
| Tool Calling | 対応 | 対応 | 対応 |
| Structured Output | 対応 | 強い | 最終出力の統合APIは弱め |
| 遅延Tool Discovery | 標準機能あり | 独自構成・Provider機能との組み合わせ | 基本的に自作 |
| OAuth・サブスク接続 | ChatGPTサインインやCodex連携の仕組みあり | 別途実装・Adapterが必要な場合あり | OAuth対応が比較的充実 |
| Agent拡張 | Middleware・Skills・Code Mode等 | Agent・Tool Loop・Middleware等 | 低レベルに制御しやすい |

この比較は当時の評価を中心にしたもので、各SDKが他の方式で同様の機能を実装できないという意味ではない。

## TanStack AIを特に評価したポイント

### ① Lazy Tool Discovery

Plugumiには大量のToolが登録される可能性がある。TanStack AIには、初めから全ToolのSchemaをモデルに渡すのではなく、必要なToolを後から発見する仕組みがある。

ただし、Plugumiの `linkId + toolPath` によるDiscoveryや階層的な検索は別途実装が必要。

### ② Structured OutputとTool Callingの併用

Toolを実行した後に、Schemaに従った構造化結果を返せる。これは以前から検討していたJSONベースのUI出力などにも利用できる。

### ③ ChatGPTサブスクとの接続

TanStack AIにはSign in with ChatGPTの仕組みがあり、これが比較時にかなり魅力的だった。

ただし、サブスク接続がすべてのProvider機能で使えるわけではない。利用条件と、実際に必要なTool Callingなどの機能が使えるかは検証が必要。

### ④ Middleware・Skills・Code Modeなど

TanStack AIはAgentを構成するための仕組みを幅広く提供している。特にMiddleware、Lazy Tools、Skills、Code ModeはPlugumiの構想と関係が深い。

## 代替案

- **Vercel AI SDK**: Structured OutputやProviderの対応が強く、Agent Loopも提供している。十分有力な候補
- **pi-ai**: モデル通信を比較的低レベルから制御でき、OAuth・モデル間の履歴変換・キャッシュ対応などが魅力。実際、旧PlugumiのAgentはTypeScript + pi-aiで実装されていた

## トレードオフと帰結

- TanStack AIの評価が上がったのは、**Plugumiが自前で実装する必要のある周辺機能を減らせる可能性**から
- 未検証: Queue・割り込み・独自Discoveryとの両立性、サブスク接続の機能範囲。採用はこれらを検証してから確定する（依存追加は規約どおり要許可）
