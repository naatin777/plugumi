package main

import (
	"context"
	"fmt"
	"io"
	"strings"

	"github.com/naatin777/plugumi/core/internal/config"
	"github.com/naatin777/plugumi/core/internal/coreinstances"
)

func runStop(ctx context.Context, output io.Writer, args []string) error {
	instances, err := coreinstances.Local()
	if err != nil {
		return err
	}
	running, err := instances.Running(ctx)
	if err != nil {
		return err
	}
	target, err := resolveRunningCore(running, args, "stop")
	if err != nil {
		return err
	}
	if err := instances.Stop(ctx, target); err != nil {
		return err
	}
	_, err = fmt.Fprintf(output, "Stop requested for %s\n", target.URL)
	return err
}

// resolveRunningCore はCLI各コマンド共通の対象Core解決。
// 引数なしは起動中1台のときだけ受理し、複数台ではURL指定を要求する。
func resolveRunningCore(running []coreinstances.Instance, args []string, command string) (coreinstances.Instance, error) {
	if len(args) != 0 {
		coreURL, err := config.NormalizeCoreURL(args[0])
		if err != nil {
			return coreinstances.Instance{}, err
		}
		for _, instance := range running {
			if instance.URL == coreURL {
				return instance, nil
			}
		}
		return coreinstances.Instance{}, fmt.Errorf("no running local Core at %s", coreURL)
	}
	switch len(running) {
	case 0:
		return coreinstances.Instance{}, fmt.Errorf("no running local Core servers")
	case 1:
		return running[0], nil
	default:
		var urls []string
		for _, instance := range running {
			urls = append(urls, instance.URL)
		}
		return coreinstances.Instance{}, fmt.Errorf("multiple Core servers are running; use plugumi %s <core-url>: %s", command, strings.Join(urls, ", "))
	}
}
