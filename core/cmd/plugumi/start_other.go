//go:build !unix && !windows

package main

import "errors"

func startBackgroundCore(string, string, string) (startedCore, error) {
	return startedCore{}, errors.New("background Core startup is only supported on Unix and Windows; use plugumi serve")
}
