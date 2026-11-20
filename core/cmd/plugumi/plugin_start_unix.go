//go:build unix

package main

import (
	"os/exec"
	"syscall"
)

func newPluginCommand(shellCommand string) (*exec.Cmd, error) {
	command := exec.Command("sh", "-c", shellCommand)
	command.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	return command, nil
}
