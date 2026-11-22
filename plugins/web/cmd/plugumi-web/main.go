// plugumi-webはブラウザ向けUIを提供するPlugin。普通のPluginと同じく
// Coreへ自分から接続・登録し、ブラウザには/apiと静的ファイルを返す。
package main

import (
	"context"
	"errors"
	"fmt"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/naatin777/plugumi/plugins/web/frontend"
	"github.com/naatin777/plugumi/plugins/web/internal/cores"
	"github.com/naatin777/plugumi/plugins/web/internal/logfile"
	"github.com/naatin777/plugumi/plugins/web/internal/plugininstances"
	"github.com/naatin777/plugumi/plugins/web/internal/server"
)

const version = "0.1.0"

const usage = `Usage: plugumi-web [--core <url>]... [<url>...] [--listen <host:port>]

Cores may also come from PLUGUMI_CORE_URL and cores saved via the UI.
--listen defaults to 127.0.0.1:0 (loopback only).`

// arguments はCLI引数の解析結果。位置引数は--coreと同じくCoreのURL。
type arguments struct {
	coreURLs []string
	listen   string
	help     bool
}

func parseArgs(args []string) (arguments, error) {
	parsed := arguments{listen: "127.0.0.1:0"}
	value := func(index *int, inline string) (string, error) {
		if inline != "" {
			return inline, nil
		}
		*index++
		if *index >= len(args) {
			return "", errors.New("missing value")
		}
		return args[*index], nil
	}
	for index := 0; index < len(args); index++ {
		arg := args[index]
		name, inline, _ := strings.Cut(arg, "=")
		switch name {
		case "--core":
			coreURL, err := value(&index, inline)
			if err != nil {
				return parsed, fmt.Errorf("--core: %w", err)
			}
			parsed.coreURLs = append(parsed.coreURLs, coreURL)
		case "--listen":
			listen, err := value(&index, inline)
			if err != nil {
				return parsed, fmt.Errorf("--listen: %w", err)
			}
			parsed.listen = listen
		case "-h", "--help":
			parsed.help = true
		default:
			if strings.HasPrefix(arg, "-") {
				return parsed, fmt.Errorf("unknown flag %q", arg)
			}
			parsed.coreURLs = append(parsed.coreURLs, arg)
		}
	}
	return parsed, nil
}

// listenAddress は--listenの値を検査する。loopback以外は受け付けない。
func listenAddress(listen string) (string, error) {
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		return "", fmt.Errorf("--listen must be a host:port pair: %w", err)
	}
	if _, err := net.LookupPort("tcp", port); err != nil {
		return "", fmt.Errorf("--listen port: %w", err)
	}
	if host != "" && host != "localhost" {
		addr := net.ParseIP(strings.Trim(host, "[]"))
		if addr == nil || !addr.IsLoopback() {
			return "", fmt.Errorf("--listen must be a loopback address (got %q)", listen)
		}
	}
	return net.JoinHostPort(host, port), nil
}

// webDir はProject保存先。~/.plugumi/web配下に<Core名>.jsonを置く。
// 他ツールのファイルと混ざる~/.plugumi直下には触れない。
func webDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".plugumi", "web")
}

// staticDist はembedしたdistを返す。
func staticDist() fs.FS {
	dist, err := fs.Sub(frontend.Dist, "dist")
	if err != nil {
		return frontend.Dist
	}
	return dist
}

func run(args []string) error {
	parsed, err := parseArgs(args)
	if err != nil {
		return err
	}
	if parsed.help {
		fmt.Println(usage)
		return nil
	}
	configured := parsed.coreURLs
	if len(configured) == 0 && os.Getenv("PLUGUMI_CORE_URL") != "" {
		configured = append(configured, os.Getenv("PLUGUMI_CORE_URL"))
	}
	listen, err := listenAddress(parsed.listen)
	if err != nil {
		return err
	}
	store, err := cores.DefaultStore()
	if err != nil {
		// 保存先が使えなくてもPlugin自体は動かす。UI追加は保存されない。
		store = nil
	}
	instanceID := plugininstances.NewID()
	manager := cores.NewManager(instanceID, os.Getenv("PLUGUMI_TOKEN"))
	defer manager.Close()
	seen := map[string]bool{}
	add := func(rawURL string, source cores.Source) error {
		normalized, err := cores.NormalizeURL(rawURL)
		if err != nil {
			return err
		}
		if seen[normalized] {
			return nil
		}
		seen[normalized] = true
		return manager.Add(normalized, source)
	}
	for _, rawURL := range configured {
		if err := add(rawURL, cores.SourceCommand); err != nil {
			return err
		}
	}
	if store != nil {
		saved, err := store.Load()
		if err != nil {
			return fmt.Errorf("could not read saved Cores: %w", err)
		}
		for _, rawURL := range saved {
			// 起動引数と重なればcommand側を優先する。
			if err := add(rawURL, cores.SourceSaved); err != nil {
				return err
			}
		}
	}
	listener, err := net.Listen("tcp", listen)
	if err != nil {
		return err
	}
	logPath := logfile.Path("web")
	unregister, registerErr := plugininstances.Register(instanceID, version, logPath)
	if registerErr == nil {
		defer unregister()
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	httpServer := &http.Server{
		Handler:           server.New(manager, store, os.Getenv("PLUGUMI_TOKEN"), staticDist(), webDir()).Handler(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(shutdownCtx)
	}()
	logfile.Write(logPath, fmt.Sprintf("[web] listening on http://%s", listener.Addr()))
	err = httpServer.Serve(listener)
	if err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n%s\n", err, usage)
		os.Exit(2)
	}
}
