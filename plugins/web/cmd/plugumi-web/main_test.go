package main

import (
	"slices"
	"testing"
)

func TestParseArgs(t *testing.T) {
	for _, test := range []struct {
		name    string
		args    []string
		want    arguments
		wantErr bool
	}{
		{
			name: "defaults",
			args: nil,
			want: arguments{listen: "127.0.0.1:0"},
		},
		{
			name: "flags and positionals",
			args: []string{"--core", "http://127.0.0.1:7700", "http://127.0.0.1:7701",
				"--core=http://127.0.0.1:7702", "--listen", "127.0.0.1:9000"},
			want: arguments{
				coreURLs: []string{"http://127.0.0.1:7700", "http://127.0.0.1:7701", "http://127.0.0.1:7702"},
				listen:   "127.0.0.1:9000",
			},
		},
		{name: "help", args: []string{"--help"}, want: arguments{listen: "127.0.0.1:0", help: true}},
		{name: "missing core value", args: []string{"--core"}, wantErr: true},
		{name: "missing listen value", args: []string{"--listen"}, wantErr: true},
		{name: "unknown flag", args: []string{"--bogus"}, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			parsed, err := parseArgs(test.args)
			if test.wantErr {
				if err == nil {
					t.Fatalf("expected an error, got %+v", parsed)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if parsed.listen != test.want.listen || parsed.help != test.want.help ||
				!slices.Equal(parsed.coreURLs, test.want.coreURLs) {
				t.Fatalf("got %+v, want %+v", parsed, test.want)
			}
		})
	}
}

func TestListenAddress(t *testing.T) {
	for _, test := range []struct {
		listen  string
		wantErr bool
	}{
		{"127.0.0.1:0", false},
		{"localhost:8080", false},
		{"[::1]:8080", false},
		{"0.0.0.0:8080", true},
		{"192.168.1.1:8080", true},
		{"example.com:8080", true},
		{"127.0.0.1", true},
		{"127.0.0.1:notaport", true},
	} {
		t.Run(test.listen, func(t *testing.T) {
			normalized, err := listenAddress(test.listen)
			if test.wantErr != (err != nil) {
				t.Fatalf("got (%q, %v), wantErr=%v", normalized, err, test.wantErr)
			}
		})
	}
}
