// Package config は plugumi.json の読み込み。
package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// Config は plugumi.json のCore設定。接続先はPlugin側が設定する。
type Config struct {
	Core struct {
		// Pluginと管理クライアントの接続先URL。
		URL string `json:"url"`
		// ブラウザUI等でCoreを識別する名前。URLの一部として使うため
		// 小文字とハイフンだけに限る。未設定でも動く。
		Name string `json:"name,omitempty"`
		// Listen はURLから導出した待受アドレス（host:port）。
		// Loadが設定する派生値で、configファイルには書かない。
		Listen string `json:"-"`
	} `json:"core"`
}

const defaultCoreURL = "http://127.0.0.1:0"

func Load(path string) (*Config, error) {
	useDefault := path == ""
	if useDefault {
		path = "plugumi.json"
	}
	var settings Config
	data, err := os.ReadFile(path)
	if err == nil {
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&settings); err != nil {
			return nil, fmt.Errorf("%s: %w", path, err)
		}
		if len(bytes.Trim(data[decoder.InputOffset():], " \t\r\n")) != 0 {
			return nil, fmt.Errorf("%s: unexpected data after Core settings", path)
		}
	} else if !useDefault || !os.IsNotExist(err) {
		return nil, err
	}
	if settings.Core.URL == "" {
		settings.Core.URL = defaultCoreURL
	}
	coreURL, err := NormalizeCoreURL(settings.Core.URL)
	if err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	settings.Core.URL = coreURL
	settings.Core.Listen = strings.TrimPrefix(coreURL, "http://")
	if err := ValidateName(settings.Core.Name); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &settings, nil
}

// namePattern はcore.nameの形式。GET /v1/core の結果をURLの一部に
// 使うため、エスケープなしでパスに載る文字だけを許可する。
var namePattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// ValidateName はcore.nameと--nameフラグ共通の検証。空は未設定として許可する。
func ValidateName(name string) error {
	if name == "" {
		return nil
	}
	if len(name) > 63 || !namePattern.MatchString(name) {
		return fmt.Errorf("core.name must be 1-63 characters of lowercase letters, digits and hyphens (got %q)", name)
	}
	return nil
}

// SetCorePort は読み込み済み設定のホストを保ったまま、ポートだけを変更する。
func (settings *Config) SetCorePort(port uint16) {
	host, _, _ := net.SplitHostPort(settings.Core.Listen)
	settings.Core.Listen = net.JoinHostPort(host, strconv.Itoa(int(port)))
	settings.Core.URL = "http://" + settings.Core.Listen
}

// NormalizeCoreURL は設定と実行中Core一覧で共通の待受URLを返す。
func NormalizeCoreURL(coreURL string) (string, error) {
	parsed, err := url.Parse(coreURL)
	invalidURL := fmt.Errorf("core.url must be an http://<host>:<port> URL")
	if err != nil || parsed.Scheme != "http" ||
		(parsed.Path != "" && parsed.Path != "/") || parsed.ForceQuery || parsed.RawQuery != "" || strings.Contains(coreURL, "#") {
		return "", invalidURL
	}
	port, valid := authorityPort(parsed)
	if !valid {
		return "", invalidURL
	}
	// 共有トークンの有無にかかわらず、現在の待受はloopbackに限定する。
	host := parsed.Hostname()
	if host != "localhost" {
		addr := net.ParseIP(host)
		if addr == nil || !addr.IsLoopback() {
			return "", fmt.Errorf("core.url must be a loopback address (got %q)", coreURL)
		}
	}
	return "http://" + net.JoinHostPort(host, strconv.FormatUint(port, 10)), nil
}

func authorityPort(parsed *url.URL) (uint64, bool) {
	port, err := strconv.ParseUint(parsed.Port(), 10, 16)
	return port, err == nil && parsed.Hostname() != "" && parsed.User == nil
}
