//go:build !unix && !windows

package main

import (
	"errors"
	"os/exec"
)

func newPluginCommand(string) (*exec.Cmd, error) {
	return nil, errors.New("background Plugin startup is only supported on Unix and Windows")
}
