//go:build unix

// startは端末から切り離したserveを起動し、パイプで待受開始の結果を受け取る。
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

	reportReader, reportWriter, err := os.Pipe()
	if err != nil {
		return startedCore{}, err
	}
	defer reportReader.Close()
	defer reportWriter.Close()
	if err := reportReader.SetReadDeadline(time.Now().Add(10 * time.Second)); err != nil {
		return startedCore{}, err
	}

	args := []string{"serve", "--config", configPath, "--port", portOverride, "--report-startup"}
	// 空の--nameを渡すと設定ファイルのcore.nameまで消えるので、指定があるときだけ付ける。
	if nameOverride != "" {
		args = append(args, "--name", nameOverride)
	}
	command := exec.Command(executable, args...)
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	command.Stdout = logFile
	command.Stderr = logFile
	command.ExtraFiles = []*os.File{reportWriter}
	command.Env = append(os.Environ(), coreLogFileEnv+"="+logFile.Name())
	if err := command.Start(); err != nil {
		return startedCore{}, err
	}
	// 子が通知前に終了した場合も、親が書き込み端を保持してEOFを妨げないようにする。
	_ = reportWriter.Close()

	var result startupResult
	if err := json.NewDecoder(reportReader).Decode(&result); err != nil {
		_ = command.Process.Kill()
		_ = command.Wait()
		return startedCore{}, fmt.Errorf("could not confirm Core startup: %w (log: %s)", err, logFile.Name())
	}
	if result.Error != "" {
		_ = command.Wait()
		return startedCore{}, fmt.Errorf("start Core: %s (log: %s)", result.Error, logFile.Name())
	}
	started := startedCore{URL: result.URL, PID: command.Process.Pid, LogPath: logFile.Name()}
	// TUIが生きている間に子が終了しても、終了ステータスを回収する。
	go func() {
		_ = command.Wait()
	}()
	return started, nil
}
