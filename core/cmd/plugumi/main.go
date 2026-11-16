// plugumi core daemon。MVPは serve のみ（フォアグラウンド常駐）。
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/naatin777/plugumi/core/internal/config"
	"github.com/naatin777/plugumi/core/internal/connector"
	"github.com/naatin777/plugumi/core/internal/registry"
	"github.com/naatin777/plugumi/core/internal/router"
	"github.com/naatin777/plugumi/core/internal/server"
)

func main() {
	if len(os.Args) < 2 || os.Args[1] != "serve" {
		log.Fatalf("usage: plugumi serve [-config plugumi.json]")
	}
	fs := flag.NewFlagSet("serve", flag.ExitOnError)
	configPath := fs.String("config", "plugumi.json", "config file path")
	_ = fs.Parse(os.Args[2:])

	cfg, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}
	coreURL := "http://" + cfg.Core.Listen

	ctx := context.Background()
	reg := registry.New()
	reg.OnExpired = func(s *registry.Session) {
		log.Printf("[core] session expired: %s (%s)", s.Plugin.ID, s.ID)
	}
	go reg.ExpireLoop(ctx, 90*time.Second, 15*time.Second)

	rt := router.New(reg)

	// 設定された各Plugin Endpointへ接続を試みる。
	for _, ep := range cfg.Plugins {
		go connector.Loop(ctx, reg, ep.Endpoint, coreURL)
	}

	srv := &http.Server{Addr: cfg.Core.Listen, Handler: server.New(reg, rt).Handler()}
	log.Printf("[core] listening on %s (config %s)", cfg.Core.Listen, *configPath)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
