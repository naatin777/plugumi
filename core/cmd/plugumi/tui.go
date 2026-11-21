package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	tea "charm.land/bubbletea/v2"
	"charm.land/lipgloss/v2"

	"github.com/naatin777/plugumi/core/internal/coreinstances"
	"github.com/naatin777/plugumi/core/internal/plugincatalog"
	"github.com/naatin777/plugumi/core/internal/plugininstances"
	"github.com/naatin777/plugumi/core/internal/tui"
)

func runTUI(configPath string) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// AltScreen宣言はView側に任せるので、起動前に明暗だけ調べて渡す。
	tui.SetDarkBackground(lipgloss.HasDarkBackground(os.Stdin, os.Stdout))

	instances, registryErr := coreinstances.Local()
	pluginRegistry, pluginErr := plugininstances.Local()
	catalog, catalogErr := plugincatalog.Local()
	model := tui.New(tui.Actions{
		FindCores: func() ([]coreinstances.Instance, error) {
			if registryErr != nil {
				return nil, registryErr
			}
			return instances.Running(ctx)
		},
		StartCore: func() (string, error) {
			core, err := startBackgroundCore(configPath, "0")
			return core.URL, err
		},
		StopCore: func(target coreinstances.Instance) error {
			if registryErr != nil {
				return registryErr
			}
			return instances.Stop(ctx, target)
		},
		RestartCore: func(target coreinstances.Instance) error {
			if registryErr != nil {
				return registryErr
			}
			return restartCore(ctx, target)
		},
		FindPlugins: func() ([]plugininstances.Instance, error) {
			if pluginErr != nil {
				return nil, pluginErr
			}
			return pluginRegistry.Running(ctx)
		},
		CatalogPlugins: func() ([]plugincatalog.Entry, error) {
			if catalogErr != nil {
				return nil, catalogErr
			}
			return catalog.List()
		},
		RegisterPlugin: func(entry plugincatalog.Entry) error {
			if catalogErr != nil {
				return catalogErr
			}
			return catalog.Add(entry)
		},
		RemovePlugin: func(name string) error {
			if catalogErr != nil {
				return catalogErr
			}
			_, err := catalog.Remove(name)
			return err
		},
		StartPlugin: func(name string) error {
			if catalogErr != nil {
				return catalogErr
			}
			_, err := startRegisteredPlugin(catalog, name)
			return err
		},
	})
	defer model.Disconnect()

	program := tea.NewProgram(model, tea.WithContext(ctx))
	_, err := program.Run()
	return err
}
