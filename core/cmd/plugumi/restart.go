package main

import (
	"context"
	"fmt"
	"io"
	"slices"
	"time"

	"github.com/naatin777/plugumi/core/internal/coreinstances"
)

func runRestart(ctx context.Context, output io.Writer, args []string) error {
	instances, err := coreinstances.Local()
	if err != nil {
		return err
	}
	running, err := instances.Running(ctx)
	if err != nil {
		return err
	}
	target, err := resolveRunningCore(running, args, "restart")
	if err != nil {
		return err
	}
	if err := restartCore(ctx, target); err != nil {
		return err
	}
	if _, err := fmt.Fprintf(output, "Restarted %s\n", target.URL); err != nil {
		return err
	}
	return nil
}

// restartCore は記録済みの起動条件で対象を止め直す。tuiのR操作からも使う。
func restartCore(ctx context.Context, target coreinstances.Instance) error {
	instances, err := coreinstances.Local()
	if err != nil {
		return err
	}
	// 停止後に同じ起動条件で立て直すため、記録済みの引数を先に取る。
	configPath, portOverride := target.ConfigPath, target.Port

	if err := instances.Stop(ctx, target); err != nil {
		return err
	}
	// stopは要求受理までしか待たない。旧Coreが残ったまま起動すると
	// 二重起動に見えるので、一覧から消えるまで待つ。
	deadline := time.Now().Add(5 * time.Second)
	for {
		running, err := instances.Running(ctx)
		if err != nil {
			return err
		}
		if !slices.ContainsFunc(running, func(instance coreinstances.Instance) bool {
			return instance.ID == target.ID
		}) {
			break
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("Core at %s did not stop in time", target.URL)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	_, err = startBackgroundCore(configPath, portOverride)
	return err
}
