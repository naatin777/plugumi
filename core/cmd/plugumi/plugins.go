package main

import (
	"context"
	"fmt"
	"io"
	"text/tabwriter"

	"github.com/naatin777/plugumi/core/internal/plugincatalog"
	"github.com/naatin777/plugumi/core/internal/plugininstances"
)

// runPlugins はcatalog登録済みと実行中のPluginを併記する。
// catalogはユーザーが登録した定義（まだ起動していなくて良い）、
// 実行中はplugininstancesのregistryで検出したもの。
// 両方に現れるものは名前で1行にまとめ、定義だけ・実行だけのものも出す。
func runPlugins(ctx context.Context, output io.Writer) error {
	catalog, catalogErr := plugincatalog.Local()
	var entries []plugincatalog.Entry
	if catalogErr == nil {
		entries, catalogErr = catalog.List()
	}

	instances, err := plugininstances.Local()
	if err != nil {
		return err
	}
	running, err := instances.Running(ctx)
	if err != nil {
		return err
	}

	// 名前で実行中を引く。catalogとregistryは別由来なので、
	// 一致しなくても各行はそのまま出す。
	runningByName := map[string]plugininstances.Instance{}
	for _, instance := range running {
		runningByName[instance.Name] = instance
	}

	type row struct {
		name    string
		state   string
		id      string
		version string
		source  string
	}
	var rows []row
	merged := make(map[string]bool, len(entries))
	for _, entry := range entries {
		line := row{name: entry.Name, state: "registered", source: entry.Command, id: "-"}
		if instance, ok := runningByName[entry.Name]; ok {
			line.state = "running"
			line.id = instance.ID
			line.version = instance.Version
			merged[instance.ID] = true
		}
		rows = append(rows, line)
	}
	for _, instance := range running {
		if merged[instance.ID] {
			continue
		}
		rows = append(rows, row{
			name: instance.Name, state: "running",
			id: instance.ID, version: instance.Version, source: "(unregistered)",
		})
	}
	if len(rows) == 0 && catalogErr == nil {
		_, err := fmt.Fprintln(output, "(no registered or running Plugins)")
		return err
	}
	// catalogが読めなくても実行中の一覧は出すが、登録定義が欠けていることは伝える。
	if catalogErr != nil {
		if _, err := fmt.Fprintf(output, "(plugin catalog unreadable: %v)\n", catalogErr); err != nil {
			return err
		}
	}

	writer := tabwriter.NewWriter(output, 0, 4, 2, ' ', 0)
	if _, err := fmt.Fprintln(writer, "NAME\tSTATE\tINSTANCE\tVERSION\tSOURCE"); err != nil {
		return err
	}
	for _, line := range rows {
		version := line.version
		if version == "" {
			version = "-"
		}
		if _, err := fmt.Fprintf(writer, "%s\t%s\t%s\t%s\t%s\n",
			line.name, line.state, line.id, version, line.source); err != nil {
			return err
		}
	}
	return writer.Flush()
}
