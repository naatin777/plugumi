---
type: decision
title: 3層のガラス空間モデル — 背景・膜・家具の分離と「浮くほど明るく」方針
description: 透明設計を3層で定義する。Layer 0は制御不能な背景（desktop・aurora・ユーザー画像）、Layer 1は背景を加工する膜（blur+tint、テーマの哲学はここに閉じ込める）、Layer 2はカード・frame・ボタンなど全てのUI面（両テーマで同一の操作をする）。面を重ねる方針は両テーマとも「浮くほど明るく」で統一し、light膜は乳白的な濁りを持つことでheadroomを保証する。
status: draft
relations:
  decision:
    - '00038'
    - '00040'
---

## コンテキスト

テーマと透明の設計で、背景が透明でも不透明でもどんなグラデーションでも違和感なく見えるようにしたい、という要件が出た。dark/lightで哲学が分かれている現状（darkは透過white-additive、lightは不透明白の混在）の整理も必要だった。

## 決定

### 3層のガラス空間モデル

- **Layer 0: 背景** — desktop（vibrancy越し）・aurora・ユーザーが選んだ画像など。制御不能・予測不能な世界
- **Layer 1: 膜** — 背景を加工する層。blur+tintで混沌を「整ったcanvas」に変換する。UIの面ではなく窓ガラスそのもの。テーマの哲学の違いはここにだけ住む:
  - darkの膜: 暗いtint + blur — 世界を暗い室内にする
  - lightの膜: 明るいtint + blur — 世界を明るい室内にする
- **Layer 2: 家具** — カード・frame・ボタンなど全てのUI面。加工済みの世界の中に住み、背景を一切意識しない。面同士の違いは層ではなく質感の選択（文字を置く面は濃く、chromeは薄く）

blurは膜の1箇所にだけ入る。家具（Layer 2）はbackdrop-filterを使わず、ただの半透明fillで済む — これは性能の答えでもある。

### 面を重ねる方針: 両テーマとも「浮くほど明るく」

2×2（明るく/暗く × 統一/逆転）のうち「常に明るく」を採る:

- 暗く重ねる方向はガラスの上で光の欠乏として読め「穴」に見えるため死ぬ
- 逆転（themeで方向を変える）は部品がthemeを意識することになり、哲学を膜に閉じ込める目的と矛盾する
- 両テーマで部品の操作は同一（白を足す）— Layer 2はthemeを知らない

### light膜は乳白的な濁りを持つ

「明るい上に明るく」を成立させるには、膜を真っ白にしてはいけない。膜がmilkyな濁り（frosted gray寄りの白）であれば、その上にpureな白を足すheadroomが必ずある。膜はtint over 任意の背景なので濁りは自然に担保されるが、設計として明記する。

### 既存実装との対応

- ElectronではOSのvibrancyが膜を提供する。browserではCSSで自前の膜を作る必要がある — auroraは既にblur(80px)焼き込み済みで、膜の簡易実装が部分的に生きている
- dark themeの現状（raised/fillが白を足す系）はこの方針と一致している
- light themeの不統一（fill=黒6-12%とraised=素白の混在）はこの方針で整理する対象

### 実験場

Style LabにBackdropStageとGlass (experimental) entryを作った。backdrop（aurora/light/dark/gradient/busy/flat）を切り替えながら素材候補を評価する。busy（最悪条件のstripes）でblur 0の透明は壊れ、blur 12以上で面が成立することが確認済み — 膜にblurが必須という根拠。
