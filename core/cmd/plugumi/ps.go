package main

import (
	"context"
	"fmt"
	"io"
	"strconv"
	"text/tabwriter"

	"github.com/naatin777/plugumi/core/internal/coreinstances"
)

func runPS(ctx context.Context, output io.Writer) error {
	instances, err := coreinstances.Local()
	if err != nil {
		return err
	}
	running, err := instances.Running(ctx)
	if err != nil {
		return err
	}
	if len(running) == 0 {
		_, err := fmt.Fprintln(output, "(no running local Core servers)")
		return err
	}
	writer := tabwriter.NewWriter(output, 0, 4, 2, ' ', 0)
	if _, err := fmt.Fprintln(writer, "URL\tNAME\tPID\tLOG"); err != nil {
		return err
	}
	for _, instance := range running {
		name, pid, logPath := "-", "-", "-"
		if instance.Name != "" {
			name = instance.Name
		}
		if instance.PID != 0 {
			pid = strconv.Itoa(instance.PID)
		}
		if instance.LogPath != "" {
			logPath = instance.LogPath
		}
		if _, err := fmt.Fprintf(writer, "%s\t%s\t%s\t%s\n", instance.URL, name, pid, logPath); err != nil {
			return err
		}
	}
	return writer.Flush()
}
