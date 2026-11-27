// plugumi core。serveは前面起動、startはバックグラウンド起動、tuiはCore管理。
package main

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/naatin777/plugumi/core/internal/config"
	"github.com/naatin777/plugumi/core/internal/coreinstances"
	"github.com/naatin777/plugumi/core/internal/server"
)

func main() {
	root := &cobra.Command{
		Use:     "plugumi",
		Short:   "Plugumi core",
		Version: "0.1.0",
	}

	var serveConfigPath, startConfigPath, tuiConfigPath string
	var servePort, startPort string
	var serveName, startName string
	var reportStartup bool

	serveCmd := &cobra.Command{
		Use:          "serve",
		Short:        "Run the core daemon in the foreground",
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runServe(serveConfigPath, servePort, serveName, reportStartup)
		},
	}
	serveCmd.Flags().StringVar(&serveConfigPath, "config", "", "config file path (uses plugumi.json if present)")
	serveCmd.Flags().StringVar(&servePort, "port", "", "override the Core port (0 lets the OS choose)")
	serveCmd.Flags().StringVar(&serveName, "name", "", "override core.name in the config file")
	serveCmd.Flags().BoolVar(&reportStartup, "report-startup", false, "report startup to the parent process")
	serveCmd.Flags().Lookup("report-startup").Hidden = true

	startCmd := &cobra.Command{
		Use:          "start",
		Short:        "Start a Core server in the background",
		Args:         cobra.NoArgs,
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runStart(cmd.OutOrStdout(), startConfigPath, startPort, startName)
		},
	}
	startCmd.Flags().StringVar(&startConfigPath, "config", "", "config file path (uses plugumi.json if present)")
	startCmd.Flags().StringVar(&startPort, "port", "", "override the Core port (0 lets the OS choose)")
	startCmd.Flags().StringVar(&startName, "name", "", "override core.name in the config file")

	stopCmd := &cobra.Command{
		Use:          "stop [core-url]",
		Short:        "Stop a running local Core server",
		Args:         cobra.MaximumNArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runStop(cmd.Context(), cmd.OutOrStdout(), args)
		},
	}

	tuiCmd := &cobra.Command{
		Use:          "tui",
		Short:        "List and manage local Core servers",
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runTUI(tuiConfigPath)
		},
	}
	tuiCmd.Flags().StringVar(&tuiConfigPath, "config", "", "config file for new Core servers (uses plugumi.json if present)")

	psCmd := &cobra.Command{
		Use:          "ps",
		Aliases:      []string{"ls", "list"},
		Short:        "List running local Core servers",
		Args:         cobra.NoArgs,
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runPS(cmd.Context(), cmd.OutOrStdout())
		},
	}

	var logsFollow bool
	var logsLines int
	logsCmd := &cobra.Command{
		Use:          "logs [core-url]",
		Short:        "Show the log of a running local Core server",
		Args:         cobra.MaximumNArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runLogs(cmd.Context(), cmd.OutOrStdout(), args, logsFollow, logsLines)
		},
	}
	logsCmd.Flags().BoolVarP(&logsFollow, "follow", "f", false, "keep printing appended log lines")
	logsCmd.Flags().IntVarP(&logsLines, "lines", "n", 50, "print the last N lines before following")

	restartCmd := &cobra.Command{
		Use:          "restart [core-url]",
		Short:        "Restart a running local Core server",
		Args:         cobra.MaximumNArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runRestart(cmd.Context(), cmd.OutOrStdout(), args)
		},
	}

	pluginsCmd := &cobra.Command{
		Use:          "plugins",
		Short:        "List registered and running local Plugins",
		Args:         cobra.NoArgs,
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runPlugins(cmd.Context(), cmd.OutOrStdout())
		},
	}

	var pluginAddCommand string
	pluginAddCmd := &cobra.Command{
		Use:          "add <name>",
		Short:        "Register a local Plugin startup command",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runPluginAdd(cmd.OutOrStdout(), args[0], pluginAddCommand)
		},
	}
	pluginAddCmd.Flags().StringVar(&pluginAddCommand, "command", "", "shell command plugumi runs to start the Plugin")
	_ = pluginAddCmd.MarkFlagRequired("command")

	pluginRemoveCmd := &cobra.Command{
		Use:          "remove <name>",
		Short:        "Remove a local Plugin startup command (does not stop the process)",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runPluginRemove(cmd.OutOrStdout(), args[0])
		},
	}

	pluginStartCmd := &cobra.Command{
		Use:          "start <name>",
		Short:        "Start a registered Plugin in the background",
		Args:         cobra.ExactArgs(1),
		SilenceUsage: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runPluginStart(cmd.OutOrStdout(), args[0])
		},
	}
	pluginsCmd.AddCommand(pluginAddCmd, pluginRemoveCmd, pluginStartCmd)

	root.AddCommand(serveCmd, startCmd, stopCmd, restartCmd, psCmd, logsCmd, pluginsCmd, tuiCmd)
	if err := root.Execute(); err != nil {
		os.Exit(1)
	}
}

// coreRuntime はserveで動くCoreのHTTPサーバーと停止処理を管理する。
type coreRuntime struct {
	ctx          context.Context
	cancel       context.CancelFunc
	settings     *config.Config
	httpServer   *http.Server
	instanceID   string
	stopToken    string
	unregister   func() error
	shutdownOnce sync.Once
}

func newRuntime(settings *config.Config) *coreRuntime {
	ctx, cancel := context.WithCancel(context.Background())
	instanceID := "core-" + rand.Text()
	stopToken := rand.Text()
	mux := http.NewServeMux()
	mux.HandleFunc("HEAD "+coreinstances.StatusPath, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set(coreinstances.IDHeader, instanceID)
		w.WriteHeader(http.StatusNoContent)
	})
	mux.HandleFunc("POST "+coreinstances.StopPath, func(w http.ResponseWriter, request *http.Request) {
		token := request.Header.Get(coreinstances.StopHeader)
		if subtle.ConstantTimeCompare([]byte(token), []byte(stopToken)) != 1 {
			w.WriteHeader(http.StatusForbidden)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		cancel()
	})
	// asset cacheはlogと同じくuser cache dir配下に置く。
	// 取れなければcacheなし（memory運用にはならずfetchは失敗する）で起動する。
	assetCacheDir := ""
	if cacheDirectory, err := os.UserCacheDir(); err == nil {
		assetCacheDir = filepath.Join(cacheDirectory, "plugumi", "assets")
	}
	mux.Handle("/", server.New(ctx, instanceID, settings.Core.Name, os.Getenv("PLUGUMI_TOKEN"), assetCacheDir).Handler())
	return &coreRuntime{
		ctx: ctx, cancel: cancel, settings: settings,
		instanceID: instanceID, stopToken: stopToken,
		httpServer: &http.Server{
			Handler: mux,
			// ヘッダだけ送って止まる接続でハンドラを占有させない
			// （loopback限定だが、止まったupgrade予約の回収を早める）。
			ReadHeaderTimeout: 10 * time.Second,
		},
	}
}

// start はPluginと管理クライアントを受け付けるHTTPサーバーを開始する。
// configPathとportOverrideはinstance記録に残し、restartが同じ条件で起動できるようにする。
// listen失敗は同期的に返す（tuiがbind失敗のまま起動しないように）。
func (r *coreRuntime) start(configPath, portOverride, nameOverride string) error {
	instances, instancesErr := coreinstances.Local()
	if instancesErr == nil && r.settings.Core.Name != "" {
		running, runningErr := instances.Running(r.ctx)
		if runningErr != nil {
			return runningErr
		}
		if conflict, found := conflictingName(running, r.settings.Core.Name); found {
			return fmt.Errorf("another running Core already uses the name %q (%s)", r.settings.Core.Name, conflict.URL)
		}
	}
	listener, err := net.Listen("tcp", r.settings.Core.Listen)
	if err != nil {
		return err
	}
	r.settings.SetCorePort(uint16(listener.Addr().(*net.TCPAddr).Port))
	if instancesErr == nil {
		instance := coreinstances.Instance{
			URL: r.settings.Core.URL, ID: r.instanceID,
			PID: os.Getpid(), LogPath: os.Getenv(coreLogFileEnv),
			ConfigPath: configPath, Port: portOverride,
			Name: r.settings.Core.Name, NameOverride: nameOverride,
		}
		r.unregister, instancesErr = instances.Register(instance, r.stopToken)
	}
	if instancesErr != nil {
		log.Printf("[core] could not publish Core to local TUI: %v", instancesErr)
	}
	log.Printf("[core] listening on %s", r.settings.Core.URL)
	go func() {
		if err := r.httpServer.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()
	go func() {
		<-r.ctx.Done()
		r.shutdown()
	}()
	return nil
}

// shutdown はHTTPサーバーとCoreが受け付けた接続を止める。
func (r *coreRuntime) shutdown() {
	r.shutdownOnce.Do(func() {
		if r.unregister != nil {
			if err := r.unregister(); err != nil && !os.IsNotExist(err) {
				log.Printf("[core] could not remove local Core registration: %v", err)
			}
		}
		r.cancel()
		// 停止リクエストへの応答を返してからHTTP接続を閉じる。
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		if err := r.httpServer.Shutdown(ctx); err != nil {
			_ = r.httpServer.Close()
		}
	})
}

type startupResult struct {
	URL   string `json:"url"`
	Error string `json:"error"`
}

// conflictingName は起動中のCoreから同名のものを探す。一覧取得と分けて検査できるよう純粋関数にする。
func conflictingName(running []coreinstances.Instance, name string) (coreinstances.Instance, bool) {
	for _, instance := range running {
		if instance.Name != "" && instance.Name == name {
			return instance, true
		}
	}
	return coreinstances.Instance{}, false
}

func runServe(configPath, portOverride, nameOverride string, reportStartup bool) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	var result startupResult
	// restartが別ディレクトリからでも同じ設定を使えるよう絶対パスにする。
	if configPath != "" {
		if absolutePath, absErr := filepath.Abs(configPath); absErr == nil {
			configPath = absolutePath
		}
	}
	settings, err := config.Load(configPath)
	if err == nil && portOverride != "" {
		port, parseErr := strconv.ParseUint(portOverride, 10, 16)
		if parseErr != nil {
			err = fmt.Errorf("--port must be an integer from 0 to 65535, got %q", portOverride)
		} else {
			settings.SetCorePort(uint16(port))
		}
	}
	if err == nil && nameOverride != "" {
		if nameErr := config.ValidateName(nameOverride); nameErr != nil {
			err = nameErr
		} else {
			settings.Core.Name = nameOverride
		}
	}
	var core *coreRuntime
	if err == nil {
		core = newRuntime(settings)
		defer core.shutdown()
		err = core.start(configPath, portOverride, nameOverride)
		result.URL = settings.Core.URL
	}
	if reportStartup {
		if err != nil {
			result.Error = err.Error()
		}
		reportErr := writeStartupReport(result)
		if reportErr != nil && err == nil {
			return fmt.Errorf("report Core startup: %w", reportErr)
		}
	}
	if err != nil {
		return err
	}
	select {
	case <-ctx.Done():
	case <-core.ctx.Done():
	}
	return nil
}

// 通知先: PLUGUMI_STARTUP_REPORT_FILE があればそのファイル、
// なければstartがExtraFilesの先頭に渡した通知用パイプ（fd 3）。
func writeStartupReport(result startupResult) error {
	if path := os.Getenv(startupReportFileEnv); path != "" {
		data, err := json.Marshal(result)
		if err != nil {
			return err
		}
		return os.WriteFile(path, append(data, '\n'), 0o600)
	}
	report := os.NewFile(3, "startup report")
	defer report.Close()
	return json.NewEncoder(report).Encode(result)
}
