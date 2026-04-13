import json
import sys
import ctypes

from PyQt5.QtCore import Qt, QThread, QTimer, pyqtSignal
from PyQt5.QtWidgets import QApplication, QLabel, QLineEdit, QPushButton, QVBoxLayout, QWidget


class CommandReader(QThread):
    command_received = pyqtSignal(dict)

    def run(self):
        for raw_line in sys.stdin:
            line = raw_line.strip()
            if not line:
                continue
            try:
                payload = json.loads(line)
            except json.JSONDecodeError:
                continue
            self.command_received.emit(payload)


class FloatingQtPanel(QWidget):
    def __init__(self):
        super().__init__()
        self._base_flags = Qt.FramelessWindowHint | Qt.Tool
        self._topmost = False
        self._is_visible = True
        self._wants_visible = True
        self._has_bounds = False

        self._build_ui()
        self._apply_window_flags(force_show=False)
        self.resize(760, 520)
        self._hide_from_taskbar_windows()
        self._start_visibility_guard()

    def _build_ui(self):
        self.setWindowTitle("QtPseudoEmbedded")

        layout = QVBoxLayout(self)
        layout.setContentsMargins(12, 12, 12, 12)
        layout.setSpacing(8)

        self.title = QLabel("这是 Python + PyQt5 独立窗口（伪嵌入跟随）")
        self.title.setStyleSheet("font-size: 14px; font-weight: 600;")

        self.status = QLabel("状态：等待 Electron 同步区域")
        self.status.setStyleSheet("font-size: 12px; color: #334155;")

        self.line = QLineEdit("拖动 Electron 试试")
        self.button = QPushButton("Python 原生按钮")
        self.button.clicked.connect(self.on_click_button)

        layout.addWidget(self.title)
        layout.addWidget(self.status)
        layout.addWidget(self.line)
        layout.addWidget(self.button)

        self.setStyleSheet(
            """
            QWidget {
                background: #ffffff;
                color: #111827;
                border: 1px solid #d1d5db;
                border-radius: 8px;
            }
            QLineEdit, QPushButton {
                min-height: 30px;
                border-radius: 6px;
                border: 1px solid #cbd5e1;
                padding: 4px 8px;
            }
            QPushButton {
                background: #f8fafc;
            }
            """
        )

    def on_click_button(self):
        value = self.line.text().strip()
        if not value:
            value = "(空文本)"
        self.status.setText(f"状态：按钮点击成功，输入内容 = {value}")

    def _hide_from_taskbar_windows(self):
        if sys.platform != "win32":
            return
        hwnd = int(self.winId())
        GWL_EXSTYLE = -20
        WS_EX_APPWINDOW = 0x00040000
        WS_EX_TOOLWINDOW = 0x00000080

        user32 = ctypes.windll.user32
        get_window_long_ptr = user32.GetWindowLongPtrW
        set_window_long_ptr = user32.SetWindowLongPtrW

        ex_style = get_window_long_ptr(hwnd, GWL_EXSTYLE)
        ex_style = (ex_style | WS_EX_TOOLWINDOW) & ~WS_EX_APPWINDOW
        set_window_long_ptr(hwnd, GWL_EXSTYLE, ex_style)
        self.hide()

    def _apply_window_flags(self, force_show=True):
        flags = self._base_flags
        if self._topmost:
            flags |= Qt.WindowStaysOnTopHint

        self.setWindowFlags(flags)
        if force_show and self._is_visible:
            self.show()

    def _start_visibility_guard(self):
        self._visibility_timer = QTimer(self)
        self._visibility_timer.setInterval(300)
        self._visibility_timer.timeout.connect(self._ensure_visibility_state)
        self._visibility_timer.start()

    def _ensure_visibility_state(self):
        if self._wants_visible and self._has_bounds:
            if not self.isVisible():
                self.show()
            self.raise_()
        elif self.isVisible() and not self.isActiveWindow():
            self.hide()

    def handle_command(self, payload: dict):
        cmd_type = payload.get("type")

        if cmd_type == "set_bounds":
            x = int(payload.get("x", 0))
            y = int(payload.get("y", 0))
            width = max(1, int(payload.get("width", 1)))
            height = max(1, int(payload.get("height", 1)))
            self.setGeometry(x, y, width, height)
            self._has_bounds = True
            self.status.setText(f"状态：已对齐容器 x={x}, y={y}, w={width}, h={height}")
            if self._is_visible:
                self.show()
                self.raise_()

        elif cmd_type == "set_visible":
            self._wants_visible = bool(payload.get("visible", True))
            self._is_visible = self._wants_visible
            if self._wants_visible and self._has_bounds:
                self.show()
                self.raise_()
            elif not self.isActiveWindow():
                self.hide()

        elif cmd_type == "set_topmost":
            topmost = bool(payload.get("topmost", False))
            if self._topmost != topmost:
                self._topmost = topmost
                self._apply_window_flags(force_show=self._is_visible and self._has_bounds)
            if self._is_visible and self._has_bounds:
                self.raise_()

        elif cmd_type == "shutdown":
            self.close()


def emit_ready(panel: FloatingQtPanel):
    hwnd = int(panel.winId())
    print(json.dumps({"event": "ready", "hwnd": hwnd}), flush=True)


if __name__ == "__main__":
    app = QApplication(sys.argv)

    panel = FloatingQtPanel()
    panel.hide()
    emit_ready(panel)

    reader = CommandReader()
    reader.command_received.connect(panel.handle_command)
    reader.start()

    exit_code = app.exec_()
    reader.quit()
    reader.wait(300)
    sys.exit(exit_code)
