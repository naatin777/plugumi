package main

import (
	"fmt"
	"io"
)

// serveに起動通知を書き込ませる先。fd継承が使えないOS（Windows）の
// startが一時ファイルのパスを渡す。未設定ならserveはfd 3のパイプへ書く。
const startupReportFileEnv = "PLUGUMI_STARTUP_REPORT_FILE"

// startが切り離したCoreへログファイルの場所を伝える環境変数。
// serveはこれをinstance記録に残し、logsコマンドが参照する。
const coreLogFileEnv = "PLUGUMI_CORE_LOG_FILE"

type startedCore struct {
	URL     string
	PID     int
	LogPath string
}

func runStart(output io.Writer, configPath, portOverride, nameOverride string) error {
	core, err := startBackgroundCore(configPath, portOverride, nameOverride)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(output, "Core started at %s (PID %d)\nLog: %s\n", core.URL, core.PID, core.LogPath)
	return err
}
