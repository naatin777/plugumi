# 用語集

Plugumiドキュメントで使う用語の正本。一般的な技術用語ではなく、**Plugumi独自の概念・使い分け**を記録する。新しい概念が生まれたらここに追加し、他のドキュメントはこの定義に従う。

## 構成要素

| 用語 | 定義 |
|---|---|
| **Core** | 中央の仲介プロセス（`core/`、Go実装）。Plugin登録・Tool呼出のルーティング・session管理を担い、機能ロジックは持たない |
| **Plugin** | 機能を提供する任意言語のプロセス（`plugins/`）。Plugumi専用でも既存アプリの拡張としても作れる |
| **UI Host** | Panel等のUIを表示する任意コンポーネント（Web/Electron等）。表示専用で実行寿命を持たない |
| **Panel** | UI Host上に表示されるPlugin提供のUI面。Panel↔Plugin間の通信はPluginの自由で、Plugumiの契約対象外 |

## 接続・実行モデル

| 用語 | 定義 |
|---|---|
| **Session** | CoreとPluginが確立する1つの接続・登録単位。`session.hello` で始まり失効で終わる。`sessionId` で識別 |
| **Registration** | session内でCoreが払い出す「このPlugin登録」を指す識別。`registrationId` で識別し、Tool呼出の宛先になる |
| **registrationId** | Core発行の一意ID。同一Plugin実装の複数登録（複数Node等）を区別するため実装IDとは別に持つ。MVPではsession-scoped |
| **core_url** | handshakeでCoreがPluginへ伝えるCore自身のURL。Plugin→Core操作・Plugin UIからの到達に使う |
| **Node** | Pluginが宣言する「実行環境」の共有識別（ローカル・Docker・リモートPC等）。Coreは意味を解釈しない |

## Tool・作業

| 用語 | 定義 |
|---|---|
| **Tool** | Pluginが提供する呼出可能な機能単位。`registrationId + toolPath` で厳格に指定する |
| **toolPath** | 登録内で一意なTool識別子（構造は未確定） |
| **Tag** | Toolに設定する検索用ラベル |
| **Discovery** | Tag・Schema等でTool候補を検索する仕組み。結果は `registrationId + toolPath` が基本 |
| **Tool Call / Invoke** | Toolの実行呼出。呼出元（Plugin）→ Core → 対象Plugin と仲介される |
| **Streaming** | Tool実行中の中間出力を連続して返す仕組み。queue/hook/result等のメッセージを流す |
| **Queue** | Agent等への入力の待ち受け機構（priority/timing付き）。`docs/decisions/00002` |
| **Event** | 状態変化・完了等の通知。具体的な形は後続設計 |

## Specbook・文書

| 用語 | 定義 |
|---|---|
| **Specbook** | 本ドキュメント体系の形式。8つのartifact type + frontmatter + relationsで構成する |
| **artifact** | `docs/<type>/NNNNN-*.md` の1ファイル。typeごとのフォルダでIDを持つ |
| **relation** | frontmatterの `relations` キーで表す外向きリンク。キーは参照先type名 |

## 方針メモ

- 人間とAIが同じJSONやUIを理解する必要はない — 「共通の意味を持つ操作・情報へ、それぞれに適した方法でアクセスできる」が本質（`docs/goals/00001`）
- 「自分で作れる」はGoalではなく信頼の境界の根拠（`docs/decisions/00001`）
