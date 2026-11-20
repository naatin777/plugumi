package tui

// pane は常駐する3ペイン。Tabと数字キーでfocusを移し、
// 画面遷移の代わりにfocusだけが動く。
type pane int

const (
	paneCores pane = iota
	panePlugins
	paneDetail
)

// detailMode はdetailペインの中身。callやhelpもペイン枠を
// 変えずに中身だけ差し替えるので、レイアウトは常に3ペインのまま。
type detailMode int

const (
	detailBrowse detailMode = iota // Registrations / Tools / Log
	detailCall                     // tool callランナー
	detailHelp                     // ? で開くキー一覧
)

var panes = [...]pane{paneCores, panePlugins, paneDetail}

// cycleFocus はfocusを次/前のペインへ移す。
func (m *Model) cycleFocus(delta int) {
	index := (int(m.focus) + delta + len(panes)) % len(panes)
	m.focusPane(panes[index])
}

func (m *Model) focusPane(next pane) {
	m.focus = next
	m.statusMsg = ""
}
