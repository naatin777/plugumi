// Package config は plugumi.json の読み込み。
package config

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
)

// Config は plugumi.json の形（docs/contracts/00001「Plugin Endpointの解決」）。
// Coreは起動設定でPlugin Endpoint一覧を持ち、各Endpointへ接続を試みる。
type Config struct {
	Core struct {
		Listen string `json:"listen"` // REST+WSを同居させる待受アドレス
	} `json:"core"`
	Plugins []PluginEndpoint `json:"plugins"`
}

type PluginEndpoint struct {
	Endpoint string `json:"endpoint"` // PluginのHTTP base URL
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
	if settings.Core.Listen == "" {
		return nil, fmt.Errorf("%s: core.listen is required", path)
	}
	// MVPは認証なし — API（Plugin動的登録・Tool呼出）を外部に
	// 公開しないよう、待受はloopbackに限定する。
	host, _, err := net.SplitHostPort(settings.Core.Listen)
	if err != nil {
		return nil, fmt.Errorf("%s: core.listen: %w", path, err)
	}
	if host != "localhost" {
		addr := net.ParseIP(host)
		if addr == nil || !addr.IsLoopback() {
			return nil, fmt.Errorf("%s: core.listen must be a loopback address (got %q)", path, settings.Core.Listen)
		}
	}
	return &settings, nil
}
