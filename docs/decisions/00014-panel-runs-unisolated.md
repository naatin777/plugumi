---
type: decision
title: PanelをWeb Pluginの画面で隔離せずに動かす
description: Pluginが提供するPanelのJSを、Web Pluginと同じOriginで直接読み込む。信頼の判断はPluginの採用時に行う。
status: draft
relations:
  decision:
    - '00001'
    - '00013'
  architecture:
    - '00002'
  requirement:
    - '00003'
    - '00004'
  contract:
    - '00004'
    - '00005'
---

## コンテキスト

[Decision 00001](00001-plugin-trust-model.md)は、インストールしたPluginを一般的な拡張機能モデルと同じく信頼すると決めた。ただし、ブラウザ内でPanelのコードが持つ権限は、実行コードへの信頼とは別に設計するとしていた。[システム構成 00002](../architecture/00002-plugin-client-system.md)は、別Originのiframeと権限を限定したBridgeでPanelを隔離する案を推奨し、試作でも管理用のOriginで任意のBundleを実行しないとしていた。

Pluginはすでに利用者のOS権限で動く任意のコードである。同じPluginが提供するPanelだけをブラウザ内で隔離しても、Pluginの本体はOS上で同じ操作ができる。隔離には、Originの設計、CSP、Bridgeの全API、iframeをまたぐフォーカスやサイズの扱いが必要になる。

## 決定

- Web Pluginは、PanelのentryのJSを、自身の画面と同じOriginに `import()` で直接読み込む。iframeやsandboxは使わない。
- PanelとWeb Pluginの間は、[Contract 00005](../contracts/00005-panel-module.md)の `mount(host, context)` でつなぐ。
- Panelを信頼するかどうかは、Decision 00001と同じく、Pluginを採用するときに利用者が判断する。

## 代替案

| 案 | 採らない理由 |
|---|---|
| 別Originのiframeと限定Bridge（00002の推奨案） | Pluginの本体がOS権限を持つので、Panelだけを隔離しても守れるものが少ない。BridgeのAPI設計と、iframeをまたぐ操作の扱いが大きい |
| sandbox属性付きのiframe（opaque origin） | 上と同じ。加えて、Panelが動的importやlocalStorageを使えなくなる |

## トレードオフと帰結

- PanelのJSは、Web Pluginの `/api` を呼べる。つまり、Web Pluginに登録されたCoreの追加・削除や、任意のPluginのToolの呼び出しができる。PanelのDOMやCSSも、他のPanelや画面全体に影響しうる。
- CSSの衝突を避ける仕組み（Scopeを付けるなど）は、見た目のためのもので、セキュリティの境界とはみなさない。
- 00002の「UI BundleとPanel通信」のうち、隔離とBridgeを前提にした記述はこの決定で置き換える。
- 再検討のきっかけ: 第三者のPluginが広く流通し、Panelごとの権限が具体的に求められたとき。
