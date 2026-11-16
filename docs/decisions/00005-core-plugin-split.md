---
type: decision
title: CoreとPluginを分割する理由
description: なぜモノリスではなくCore/Pluginプロセス分割の構成を取るかの根拠。
status: draft
relations:
  architecture:
    - '00001'
---

## コンテキスト

Plugumiの基本構造は「薄いCore + 機能を持つPlugin群」である。この分割は自明ではなく、モノリシックな拡張機構（in-processモジュール等）も有力な選択肢だった。分割の根拠を記録する。

## 決定

CoreとPluginを別プロセスとして分割する。理由:

1. **言語・フロントエンドの自由**: Pluginは任意言語・任意フロントエンドで書ける。プロセス境界があるから実装技術を強制しない
2. **Coreを薄く保てる**: CoreはAI非依存の仲介（登録・ルーティング・session管理）に留まり、機能は全てPlugin側に置ける。Coreの複雑化・機能肥大を構造的に防ぐ
3. **寿命の分離**: Pluginの障害・再起動・個別更新がCoreや他Pluginの寿命を侵さない
4. **実行場所の拡張性**: Pluginを別マシン・コンテナ（Node）で動かすモデルが、プロセス分割だと自然に成立する

## 代替案

- **in-process拡張（動的ライブラリ・スクリプト言語埋め込み等）**: 起動・通信が単純になるが、言語選択の自由・障害分離・Node分散を失う
- **Pluginなしのモノリス**: 拡張性というGoalの根幹（`docs/goals/00004`）と矛盾する

## トレードオフと帰結

- プロセス間通信（transport契約・接続管理・障害処理）の複雑さを引き受ける — `docs/contracts/00001` がその対価
- 機能追加が「Core変更」ではなく「Pluginを書く」になるため、利用者にとってのカスタマイズ入口が明確になる
- Plugin間連携もCore仲介となるため、相互通信の契約もCoreに集約される（`docs/architecture/00001` のPlugin間直接通信禁止と整合）
