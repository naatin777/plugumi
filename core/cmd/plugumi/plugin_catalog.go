package main

import (
	"fmt"
	"io"

	"github.com/naatin777/plugumi/core/internal/plugincatalog"
)

// runPluginAdd はcatalogにPlugin定義を登録する。同名は上書き。
// 接続先はPluginの起動コマンドで設定する。
func runPluginAdd(output io.Writer, name, command string) error {
	catalog, err := plugincatalog.Local()
	if err != nil {
		return err
	}
	entry := plugincatalog.Entry{Name: name, Command: command}
	if err := catalog.Add(entry); err != nil {
		return err
	}
	_, err = fmt.Fprintf(output, "Registered %q in %s\n", name, catalog.Path())
	return err
}

func runPluginRemove(output io.Writer, name string) error {
	catalog, err := plugincatalog.Local()
	if err != nil {
		return err
	}
	removed, err := catalog.Remove(name)
	if err != nil {
		return err
	}
	if !removed {
		return fmt.Errorf("no registered Plugin named %q", name)
	}
	_, err = fmt.Fprintf(output, "Removed %q\n", name)
	return err
}
