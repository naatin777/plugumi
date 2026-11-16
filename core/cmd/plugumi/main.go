// plugumi core。serveはheadless常駐、tuiは管理TUI
// （core.urlに既にcoreが応答するならアタッチ、いなければ同時に起動）。
package main

import (
	"context"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/naatin777/plugumi/core/internal/config"
	"github.com/naatin777/plugumi/core/internal/connector"
	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/router"
	"github.com/naatin777/plugumi/core/internal/server"
)

func main() {
	root := &cobra.Command{
		Use:   "plugumi",
		Short: "Plugumi core",
	}

	var serveConfig, tuiConfig string

	serveCmd := &cobra.Command{
		Use:          "serve",
		Short:        "Run the core daemon in the foreground",
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runServe(serveConfig)
		},
	}
	serveCmd.Flags().StringVar(&serveConfig, "config", "plugumi.json", "config file path")

	tuiCmd := &cobra.Command{
		Use:          "tui",
		Short:        "Open the management TUI (starts core unless already running)",
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runTUI(tuiConfig)
		},
	}
	tuiCmd.Flags().StringVar(&tuiConfig, "config", "plugumi.json", "config file path")

	root.AddCommand(serveCmd, tuiCmd)
	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

// runtime はserveとtuiで共有するcoreの配線一式。
type runtime struct {
	ctx             context.Context
	cancel          context.CancelFunc
	settings        *config.Config
	links           *registry.Registry
	callRouter      *router.Router
	pluginConnector *connector.Connector
	srv             *http.Server
}

func newRuntime(configPath string) (*runtime, error) {
	settings, err := config.Load(configPath)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithCancel(context.Background())
	links := registry.New()
	callRouter := router.New(links)
	// core.idはプロセスごとの識別子。永続化は未解決
	// （contracts/00001。再起動では旧Linkが失効期限で消える）。
	pluginConnector := connector.New(ctx, links, connector.NewID("core-"))
	links.OnExpired = func(link *registry.Link) {
		// hello未完了で落ちたLink（plugin未到達のretry毎）はログを出さない。
		if plugin := link.Plugin(); plugin.ID != "" {
			log.Printf("[core] link expired: %s (%s)", plugin.ID, link.ID)
		}
		// Link失効でそのconnに紐付く経路を閉じる。閉じないと呼び出し中の
		// 相手側（caller/target）に終端もcloseも届かない。
		if conn := link.Transport(); conn != nil {
			callRouter.DropConn(conn)
		}
		// Link失効でもcatalogが変わる（そのLinkのToolが消えるため）。
		pluginConnector.BroadcastCatalog()
	}
	return &runtime{
		ctx: ctx, cancel: cancel, settings: settings,
		links: links, callRouter: callRouter, pluginConnector: pluginConnector,
		srv: &http.Server{
			Addr:    settings.Core.Listen,
			Handler: server.New(links, callRouter, pluginConnector).Handler(),
		},
	}, nil
}

// start はHTTP listenとPlugin Endpointへの接続loopを開始する。
// listen失敗は同期的に返す（tuiがbind失敗のまま起動しないように）。
func (r *runtime) start(configPath string) error {
	for _, plugin := range r.settings.Plugins {
		r.pluginConnector.Watch(plugin.Endpoint)
	}
	go r.links.ExpireLoop(r.ctx, 90*time.Second, 15*time.Second)

	listener, err := net.Listen("tcp", r.settings.Core.Listen)
	if err != nil {
		return err
	}
	log.Printf("[core] listening on %s (config %s)", r.settings.Core.Listen, configPath)
	go func() {
		if err := r.srv.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()
	return nil
}

// shutdown はHTTP serverと全接続loopを止める。
func (r *runtime) shutdown() {
	r.cancel()
	if r.srv != nil {
		_ = r.srv.Close()
	}
}

func runServe(configPath string) error {
	rt, err := newRuntime(configPath)
	if err != nil {
		return err
	}
	defer rt.shutdown()
	if err := rt.start(configPath); err != nil {
		return err
	}
	// SIGINT/SIGTERMまでブロック。gracefulにconnector loopとLinkを畳む。
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(sigCh)
	<-sigCh
	return nil
}

// coreIsRunning はcore.urlの管理RESTが応答するかを調べる。
// 200が返ればserve済みのcoreへTUIがアタッチできる。
func coreIsRunning(coreURL string) bool {
	client := &http.Client{Timeout: 800 * time.Millisecond}
	resp, err := client.Post(coreURL+"/v1/tools/list", "application/json", nil)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}
