//go:build windows

package main

import "os/exec"

func newPluginCommand(shellCommand string) (*exec.Cmd, error) {
	return exec.Command("cmd", "/C", shellCommand), nil
}
