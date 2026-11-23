---
type: design
title: Web Pluginの画面階層とCoreの選択
description: Web PluginのURL構成、Core > Project > Area > Workspaceの階層、Coreの追加と名前の解決を定める。
status: draft
relations:
  requirement:
    - '00003'
    - '00004'
  decision:
    - '00013'
  contract:
    - '00004'
---

## 対応するrequirement

[Requirement 00003](../requirements/00003-plugin-ecosystem-support.md)は、同じPluginプロセスが複数のCoreへ独立に接続できることを求めている。[Requirement 00004](../requirements/00004-common-protocol-contracts.md)は、人間がPluginの機能や結果を画面から利用できることを求めている。本書は、[Decision 00013](../decisions/00013-web-plugin-gateway.md)で決めたWeb Pluginについて、複数のCoreを1つのブラウザ画面で切り替える方法と、画面の階層を定める。

## 画面の階層

```mermaid
flowchart LR
    Core["Core（組織）"] --> Project["Project"]
    Project --> Area["Area（worktree・package・別repositoryなど）"]
    Area --> Child["子のArea（入れ子にできる）"]
    Area --> Workspace["Workspace（Areaに1つ）"]
    Workspace --> Main["Main（Dock: left / bottom / center）"]
    Workspace --> Side["Side（右の列）"]
    Main --> Panel["Panel"]
    Side --> Panel
```

- Areaは入れ子にでき、フォルダのようなツリーになる。親のAreaも子のAreaも、それぞれWorkspaceを1つずつ持つ。
- WorkspaceはAreaと1対1に対応する。Workspaceは**Main**（left・bottom・centerの領域）と**Side**（右の列）に分かれる。SideはSigmaOSのSideページ相当で、Mainの脇に常時置くPanelの置き場。
- 各DockはPanelのタブを並べる。center Dockは`axis`と`ratio`を持つsplitの再帰ツリーで区画に分ける。タブを区画の四辺にドラッグ&ドロップすると、その方向に分割する。表示方式（pages）と保存の形は[Design 00005](00005-shell-region-model.md)に従う。
- Panelはregionをまたいでドラッグできる。Main⇔Sideを含む全領域の相互移動に対応し、ドロップ先のタブ帯上では位置を計算して挿入する。分割後の葉が小さくなりすぎる場合はsplitせず挿入にフォールバックする。sidebarのMain/Sideセクションに落としても移せる。
- Areaが何を持つか（参照するリソースや種類の表し方）は、入れ子の構造のほかは未決定。
- Areaが何を持つか（参照するリソースや種類の表し方）は、入れ子の構造のほかは未決定。

## 画面の構成

Plugin Shell（[Decision 00015](../decisions/00015-electron-plugin-shares-plugin-shell.md)によりWeb PluginとElectron Pluginが共有する画面）の外枠は、上から OS帯・本体・ステータス帯 の3段で構成する。

- **OS帯（最上段）**: PWAのWindow Controls OverlayやElectronのtitleBarOverlayが重なる帯。ここに置く操作はShell固有で、Pluginからのカスタマイズは受け付けない。左端にサイドバー（ProjectタブとAreaツリー）の開閉とCore switcher（現在のCore名と接続状態、Coreの切り替えとCoreの管理への入口）、work区間にPanel追加（「+」のpicker）とleft/bottom/sideの開閉、右端に両サイド一括畳み（sidebarとsideをまとめて引っ込める。個別の開閉状態は潰さない）とテーマ切替（system/light/darkを順に回す。systemはOSの明暗に追従し、選択は端末に保存する）を持つ。
- **本体**: 左のサイドバー（ProjectタブとAreaツリーに加え、WorkspaceのPanelをMain/Sideで分けて一覧する）、中央のWorkspaceのDock（left・bottom・center・side）。
- **ステータス帯（最下段）**: 左に接続状態などの文字列、右にIndicator（Plugin View）のマウント領域を持つ。Indicator自体の登録とマウントは未実装。

Coreの切り替えを一番外側の帯に置くのは、Coreが接続先でありProject以下がCoreごとに分かれた状態だからである。`/<core>/` に移動すると、そのCoreでこの端末が最後に開いていた場所へ戻る。

## 保存

Project・Area・Workspaceの状態は、Web Pluginのサーバーが `~/.plugumi/web/<Core名>.json` に保存する。Coreはこれらの階層を扱わない。

- Core名をキーにする。`coreId` はCoreの再起動で変わるので、Core名のないCoreではProjectを作れない。
- PanelはPanel InstanceのIDと、Pluginの識別子（`pluginId`）と `panelId` で保存する。登録の識別子（`registrationId`）はPluginの再起動で変わるので保存しない。表示するときに、同じPluginの同じPanelを提供している登録を探す。
- Workspaceの中身はPlugin Shellが所有するJSONで、Web Pluginのサーバーは解釈せずに保存する。形は[Design 00005](00005-shell-region-model.md)の「保存の形」に従う。
- 同じWorkspaceを複数のタブで同時に編集した場合は、後から保存した内容が残る。
- `~/.plugumi/` には旧リポジトリのファイルが残っている場合がある。Web Pluginは `~/.plugumi/web/` の下だけを使い、それ以外には触れない。

## URL

| パス | 画面 |
|---|---|
| `/` | Core一覧。Coreの追加と削除もここで行う |
| `/<core>/` | この端末で最後に開いた場所へ移動する。なければ先頭のProject、ProjectもなければPlugin Shellの画面 |
| `/<core>/<project>/` | Projectの画面。Areaのツリーを表示する |
| `/<core>/<project>/<area>/<子のarea>/...` | そのAreaのWorkspace |

`<core>` にはCore名を使う。Core名がないCoreは `coreId` で表すが、`coreId` はCoreの再起動で変わるため、ブックマークには使えない。

ProjectとAreaは、名前をそのままURLの識別子にする。名前の形式はCore名と同じ（小文字の英数字とハイフン、1〜63文字）で、同じ親の中では重複できない。Projectの名前はCoreの中で、Areaの名前は同じ親のAreaの中で一意とする。

Web Plugin自身も、APIの `/api/`、ビルド済みファイルの `/assets/`、PanelのUIファイルを中継する `/ui/` をパスの先頭に使う。そのため、Web Pluginは `api`・`assets`・`ui` をCore名として予約し、URLには使わない。これらはWeb Plugin側の都合なので、Coreの設定では禁止しない。Core名が予約名と同じCoreは、画面から追加できない。`--core` で指定されている場合は一覧に表示するが、リンクは作らない。

## Coreの一覧と名前の解決

Web Pluginは2種類の経路で接続先を受け取る。

| 経路 | 保存 | 画面からの削除 |
|---|---|---|
| 起動コマンドの `--core`、または `PLUGUMI_CORE_URL` | しない（起動のたびに指定する） | できない |
| `/` の画面から追加 | Web Pluginの設定ファイルに保存する | できる |

同じoriginのURLは1つにまとめる。接続先が1つもない状態でも、Web Pluginは起動する。

```mermaid
sequenceDiagram
    participant B as ブラウザ
    participant W as Web Plugin
    participant C as Core
    B->>W: / でCore URLを追加
    W->>C: GET /v1/core
    C-->>W: { coreId, name }
    W->>W: 名前がない、または登録済みの名前と重複すれば拒否
    W->>W: URLを保存
    W->>C: POST /v1/registrations（以降は他のPluginと同じ）
    W-->>B: /<name>/ に移動できる
```

- 画面から追加するときは、Core名が必須である。名前がなければ、Web Pluginは「`core.name` を設定してください」と返して追加を断る。
- Web Pluginは、Coreに登録するたびに `GET /v1/core` を呼び、`coreId` とCore名を取り直す。Core名が変わった場合、Web Pluginは新しい名前でURLを作り、古いURLは使えなくなる。
- 保存されるのはURLなので、Coreのポートは固定する必要がある。Coreの既定のポートは `0` で、起動のたびに変わる。

## Core名の一意性

- Coreは起動時に、同じOSユーザーで動いている他のCoreを調べ、同じCore名のCoreがあれば起動しない。
- Web Pluginは、画面から追加するCoreの名前が、接続中の他のCoreと重なれば追加を断る。
- 別のマシンのCoreとの名前の重複は、まだ扱わない。現行のCoreはloopbackでだけ待ち受ける。

## インターフェース

Core名を返すAPIは[接続契約 00004](../contracts/00004-plugin-client-protocol.md)の `GET /v1/core` を正本とする。ブラウザとWeb Pluginの間のAPIは、Web Plugin内部のものとして扱い、契約にはしない。

## 未解決の問い

- Areaが入れ子の構造のほかに持つ内容
- 名前に日本語などを使えるようにするか（表示名とURLの識別子を分けるか）
- 同時編集を後勝ちより丁寧に扱う必要があるか
- 同じマシンで動いているCoreを、URLを入力せずに一覧から選べるようにするか
- 別のマシンのCoreを扱うときの、Core名の重複と認証
