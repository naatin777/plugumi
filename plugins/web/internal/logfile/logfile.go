// Package logfile はPluginプロセスの診断ログファイルを扱う。
// 1プロセスが複数Coreに繋がるためパスはPluginが自分で決め、
// plugumi経由の起動でなくても記録される（agentのlog.tsと同じ場所）。
package logfile

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
)

// Path は<cache dir>/plugumi/logs/<name>-<pid>.logを返す。
// 開けなくてもPlugin自体は動かすため、失敗時は空を返す。
func Path(name string) string {
	cacheDirectory, err := os.UserCacheDir()
	if err != nil {
		return ""
	}
	directory := filepath.Join(cacheDirectory, "plugumi", "logs")
	if err := os.MkdirAll(directory, 0o700); err != nil {
		return ""
	}
	return filepath.Join(directory, fmt.Sprintf("%s-%d.log", name, os.Getpid()))
}

// Write は診断を標準エラーとログファイルの両方へ書く。
// 書き込み失敗も本体の処理を止めない。
func Write(path, message string) {
	log.Print(message)
	if path == "" {
		return
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer file.Close()
	_, _ = fmt.Fprintln(file, message)
}
