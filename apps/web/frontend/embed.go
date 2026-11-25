// Package frontend はビルド済みブラウザUIをGoバイナリへ同梱する。
// distが未ビルド（index.htmlなし）でもgo buildできるよう.gitkeepを置く。
package frontend

import "embed"

//go:embed all:dist
var Dist embed.FS
