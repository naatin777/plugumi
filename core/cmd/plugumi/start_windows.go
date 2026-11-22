//go:build windows

// Windows版start。UnixのSetsid相当としてDETACHED_PROCESSで子をコンソールから
// 切り離す。fd継承（ExtraFiles）が使えないため、起動通知は一時ファイル経由にする。
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"
)

const (
	// WinBase.hのCreationFlags値。x/sysを増やさないため数値で保持する。
	// CREATE_NO_WINDOWと違い、DETACHED_PROCESSはコンソール自体を持たない
	// ため、親のコンソールウィンドウを閉じても子は終了しない。
	detachedProcess       = 0x00000008
	createNewProcessGroup = 0x00000200
)

func startBackgroundCore(configPath, portOverride, nameOverride string) (startedCore, error) {
	executable, err := os.Executable()
	if err != nil {
		return startedCore{}, err
	}
	cacheDirectory, err := os.UserCacheDir()
	if err != nil {
		return startedCore{}, err
	}
	logDirectory := filepath.Join(cacheDirectory, "plugumi", "logs")
	if err := os.MkdirAll(logDirectory, 0700); err != nil {
		return startedCore{}, err
	}
	logFile, err := os.CreateTemp(logDirectory, "core-*.log")
	if err != nil {
		return startedCore{}, err
	}
	defer logFile.Close()

	reportFile, err := os.CreateTemp("", "plugumi-startup-*.json")
	if err != nil {
		return startedCore{}, err
	}
	reportPath := reportFile.Name()
	if err := reportFile.Close(); err != nil {
		return startedCore{}, err
	}
	defer os.Remove(reportPath)

	args := []string{"serve", "--config", configPath, "--port", portOverride, "--report-startup"}
	// 空の--nameを渡すと設定ファイルのcore.nameまで消えるので、指定があるときだけ付ける。
	if nameOverride != "" {
		args = append(args, "--name", nameOverride)
	}
	command := exec.Command(executable, args...)
	command.SysProcAttr = &syscall.SysProcAttr{
		CreationFlags: detachedProcess | createNewProcessGroup,
	}
	command.Stdout = logFile
	command.Stderr = logFile
	command.Env = append(os.Environ(),
		startupReportFileEnv+"="+reportPath,
		coreLogFileEnv+"="+logFile.Name(),
	)
	if err := command.Start(); err != nil {
		return startedCore{}, err
	}
	// 子の終了ステータス回収と早期終了の検知を兼ねる。Waitはこの1回だけ。
	exited := make(chan error, 1)
	go func() { exited <- command.Wait() }()

	// serveがreportを書くまで待つ。早期終了・タイムアウト・デコード成功の3分岐。
	deadline := time.After(10 * time.Second)
	var result startupResult
	for {
		data, readErr := os.ReadFile(reportPath)
		if readErr == nil && len(data) > 0 {
			if err := json.Unmarshal(data, &result); err == nil {
				break
			}
		}
		select {
		case waitErr := <-exited:
			return startedCore{}, fmt.Errorf("Core exited before reporting startup: %v (log: %s)", waitErr, logFile.Name())
		case <-deadline:
			_ = command.Process.Kill()
			<-exited
			return startedCore{}, fmt.Errorf("could not confirm Core startup (log: %s)", logFile.Name())
		case <-time.After(25 * time.Millisecond):
		}
	}
	if result.Error != "" {
		<-exited
		return startedCore{}, fmt.Errorf("start Core: %s (log: %s)", result.Error, logFile.Name())
	}
	return startedCore{URL: result.URL, PID: command.Process.Pid, LogPath: logFile.Name()}, nil
}
