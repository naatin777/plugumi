package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"syscall"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/naatin777/plugumi/core/internal/config"
	"github.com/naatin777/plugumi/core/internal/tui"
)

// runTUI は管理TUIを開く。core.urlに既にcoreが応答するならそれへ
// アタッチし、いなければconfigどおりにcoreをこのプロセスで起動する。
// coreのログはTUIが端末を占有するためLogBuffer経由でTUI内に流す。
func runTUI(configPath string) error {
	settings, err := config.Load(configPath)
	if err != nil {
		return err
	}

	logBuf := tui.NewLogBuffer(500)
	log.SetOutput(logBuf)

	var rt *runtime
	if coreIsRunning(settings.Core.URL) {
		log.Printf("[tui] attached to running core at %s", settings.Core.URL)
	} else {
		rt, err = newRuntime(configPath)
		if err != nil {
			return err
		}
		if err := rt.start(configPath); err != nil {
			rt.shutdown()
			return err
		}
		defer rt.shutdown()
	}

	client, err := tui.NewClient(settings.Core.URL)
	if err != nil {
		return err
	}
	model := tui.New(client, settings.Core.URL, logBuf)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	program := tea.NewProgram(model, tea.WithAltScreen(), tea.WithContext(ctx))
	_, err = program.Run()
	return err
}
