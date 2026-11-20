package main

import (
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/naatin777/plugumi/core/internal/plugincatalog"
)

type startedPlugin struct {
	PID     int
	LogPath string
}

func runPluginStart(output io.Writer, name string) error {
	catalog, err := plugincatalog.Local()
	if err != nil {
		return err
	}
	started, err := startRegisteredPlugin(catalog, name)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(output, "Started %q (PID %d, log: %s)\n", name, started.PID, started.LogPath)
	return err
}

// Pluginが自分でCoreに登録するので、接続完了までは待たない。
func startRegisteredPlugin(catalog plugincatalog.Catalog, name string) (startedPlugin, error) {
	entry, found, err := catalog.Find(name)
	if err != nil {
		return startedPlugin{}, err
	}
	if !found {
		return startedPlugin{}, fmt.Errorf("no registered Plugin named %q", name)
	}
	return startBackgroundPlugin(entry)
}

func startBackgroundPlugin(entry plugincatalog.Entry) (startedPlugin, error) {
	// パイプや引用符を含む起動コマンドを解釈できるよう、シェルを使う。
	command, err := newPluginCommand(entry.Command)
	if err != nil {
		return startedPlugin{}, err
	}
	cacheDirectory, err := os.UserCacheDir()
	if err != nil {
		return startedPlugin{}, err
	}
	logDirectory := filepath.Join(cacheDirectory, "plugumi", "logs")
	if err := os.MkdirAll(logDirectory, 0o700); err != nil {
		return startedPlugin{}, err
	}
	logFile, err := os.CreateTemp(logDirectory, "plugin-"+entry.Name+"-*.log")
	if err != nil {
		return startedPlugin{}, err
	}
	defer logFile.Close()

	command.Stdout = logFile
	command.Stderr = logFile
	if err := command.Start(); err != nil {
		return startedPlugin{}, err
	}
	started := startedPlugin{PID: command.Process.Pid, LogPath: logFile.Name()}
	// TUIのように起動元が残る場合も、子の終了ステータスは回収する。
	go command.Wait()
	return started, nil
}
