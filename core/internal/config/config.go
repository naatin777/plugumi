// Package config は plugumi.json の読み込み。
package config

import (
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
)

// Config は plugumi.json の形（docs/contracts/00001「Plugin Endpointの解決」）。
// Coreは起動設定でPlugin Endpoint一覧を持ち、各Endpointへ接続を試みる。
type Config struct {
	Core struct {
		// Core管理REST APIの待受URL（Plugin向けではなく人間・UI向け）。
		URL string `json:"url"`
		// Listen はURLから導出した待受アドレス（host:port）。
		// Loadが設定する派生値で、configファイルには書かない。
		Listen string `json:"-"`
	} `json:"core"`
	Plugins []PluginEndpoint `json:"plugins"`
}

type PluginEndpoint struct {
	Endpoint string `json:"endpoint"` // Pluginのws(s) URL
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var settings Config
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if settings.Core.URL == "" {
		return nil, fmt.Errorf("%s: core.url is required", path)
	}
	parsed, err := url.Parse(settings.Core.URL)
	if err != nil || parsed.Host == "" {
		return nil, fmt.Errorf("%s: core.url must be an http(s) URL (got %q)", path, settings.Core.URL)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return nil, fmt.Errorf("%s: core.url must be an http(s) URL (got %q)", path, settings.Core.URL)
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return nil, fmt.Errorf("%s: core.url must not have a path (got %q)", path, settings.Core.URL)
	}
	// MVPは認証なし。API（Plugin動的登録・Tool呼び出し）を外部に
	// 公開しないよう、待受はloopbackに限定する。
	host := parsed.Hostname()
	if host != "localhost" {
		addr := net.ParseIP(host)
		if addr == nil || !addr.IsLoopback() {
			return nil, fmt.Errorf("%s: core.url must be a loopback address (got %q)", path, settings.Core.URL)
		}
	}
	for i, plugin := range settings.Plugins {
		u, err := url.Parse(plugin.Endpoint)
		if err != nil || (u.Scheme != "ws" && u.Scheme != "wss") || u.Host == "" {
			return nil, fmt.Errorf("%s: plugins[%d].endpoint must be a ws(s):// URL (got %q)", path, i, plugin.Endpoint)
		}
	}
	settings.Core.Listen = parsed.Host
	return &settings, nil
}
