// Package config は plugumi.json の読み込み。
package config

import (
	"encoding/json"
	"fmt"
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
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(b, &cfg); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	if cfg.Core.Listen == "" {
		return nil, fmt.Errorf("%s: core.listen is required", path)
	}
	return &cfg, nil
}
