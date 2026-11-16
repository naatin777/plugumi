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
	serveFlags := flag.NewFlagSet("serve", flag.ExitOnError)
	configPath := serveFlags.String("config", "plugumi.json", "config file path")
	_ = serveFlags.Parse(os.Args[2:])

	settings, err := config.Load(*configPath)
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	ctx := context.Background()
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
	go links.ExpireLoop(ctx, 90*time.Second, 15*time.Second)

	// 設定された各Plugin Endpointへ接続を試みる（動的登録はPOST /v1/plugins）。
	for _, plugin := range settings.Plugins {
		pluginConnector.Watch(plugin.Endpoint)
	}

	srv := &http.Server{Addr: settings.Core.Listen, Handler: server.New(links, callRouter, pluginConnector).Handler()}
	log.Printf("[core] listening on %s (config %s)", settings.Core.Listen, *configPath)
	if err := srv.ListenAndServe(); err != nil {
		log.Fatalf("serve: %v", err)
	}
}
