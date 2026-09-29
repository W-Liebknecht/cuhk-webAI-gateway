"""Minimal local settings panel for the CUHK AI agent bridge."""

from __future__ import annotations

import json
import subprocess
import sys
import tkinter as tk
from pathlib import Path
from tkinter import filedialog, messagebox, ttk


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config.json"
OPENCLI = ROOT / "bin" / "opencli.cmd"
CODEX_LAUNCHER = ROOT / "bin" / "cuhk-codex-launch.ps1"

MODELS = {
    "glm5.3flash": {"label": "GLM 5.3 Flash（本地版）", "thinking": ["low", "high", "max"]},
    "glm5.3": {"label": "GLM 5.3", "thinking": []},
    "gpt5.6sol": {"label": "GPT 5.6 Sol", "thinking": ["none", "low", "medium", "high", "xhigh", "max"]},
    "gpt6sol": {"label": "GPT 6 Sol", "thinking": ["none", "low", "medium", "high", "xhigh", "max"]},
    "gpt6luna": {"label": "GPT 6 Luna", "thinking": ["none", "low", "medium", "high", "xhigh", "max"]},
    "deepseek-v4.1-flash": {"label": "DeepSeek V4.1 Flash", "thinking": ["none", "high", "max"]},
    "kimi-k3": {"label": "Kimi K3", "thinking": ["low", "high", "max"]},
    "seed2.1pro": {"label": "豆包 Seed 2.1 Pro", "thinking": ["none", "high"]},
    "gemini3.8flash": {"label": "Gemini 3.8 Flash", "thinking": ["low", "high"]},
    "qwen3.8-27b": {"label": "Qwen3.8 27B（本地版）", "thinking": ["none", "low", "medium", "xhigh"]},
}

THINKING_LABELS = {
    "none": "不思考",
    "low": "低",
    "medium": "中",
    "high": "高",
    "xhigh": "超高",
    "max": "极致",
}


def default_config() -> dict[str, object]:
    return {
        "consultationEnabled": False,
        "gatewayEnabled": True,
        "model": "glm5.3flash",
        "thinking": "low",
        "workdir": "",
    }


def normalize_config(value: object) -> dict[str, object]:
    source = value if isinstance(value, dict) else {}
    config = default_config()
    config.update(source)
    legacy_enabled = bool(source.get("enabled", True))
    consultation_enabled = bool(source.get("consultationEnabled", legacy_enabled))
    gateway_enabled = bool(source.get("gatewayEnabled", legacy_enabled))
    model = str(config.get("model", ""))
    if model not in MODELS:
        model = "glm5.3flash"
    levels = MODELS[model]["thinking"]
    thinking = config.get("thinking")
    workdir = str(config.get("workdir") or "").strip()
    if workdir and not Path(workdir).is_dir():
        workdir = ""
    if not levels:
        thinking = None
    elif thinking not in levels:
        thinking = levels[0]
    return {
        "consultationEnabled": consultation_enabled,
        "gatewayEnabled": gateway_enabled,
        "model": model,
        "thinking": thinking,
        "workdir": workdir,
    }


def load_config() -> dict[str, object]:
    try:
        return normalize_config(json.loads(CONFIG_PATH.read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        return default_config()


def save_config(config: dict[str, object]) -> None:
    normalized = normalize_config(config)
    temporary = CONFIG_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(normalized, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(CONFIG_PATH)


class SettingsApp:
    def __init__(self, root: tk.Tk) -> None:
        self.root = root
        self.root.title("CUHK AI 控制面板")
        self.root.geometry("520x460")
        self.root.resizable(False, False)

        style = ttk.Style(root)
        if "vista" in style.theme_names():
            style.theme_use("vista")
        style.configure("Title.TLabel", font=("Microsoft YaHei UI", 16, "bold"))
        style.configure("Status.TLabel", foreground="#2563eb")

        self.config = load_config()
        self.consultation_enabled = tk.BooleanVar(value=bool(self.config["consultationEnabled"]))
        self.gateway_enabled = tk.BooleanVar(value=bool(self.config["gatewayEnabled"]))
        self.model_label = tk.StringVar(value=MODELS[str(self.config["model"])]["label"])
        self.thinking_label = tk.StringVar()
        self.status = tk.StringVar(value="配置已加载")

        self.workdir_var = tk.StringVar(value=str(self.config.get("workdir") or ""))
        frame = ttk.Frame(root, padding=24)
        frame.pack(fill="both", expand=True)
        ttk.Label(frame, text="CUHK AI 控制面板", style="Title.TLabel").pack(anchor="w")
        ttk.Label(frame, text="咨询与 Gateway 独立开关，共享下方模型设置。").pack(anchor="w", pady=(4, 18))

        ttk.Checkbutton(
            frame,
            text="自动咨询学校网页 AI",
            variable=self.consultation_enabled,
            command=self._changed,
        ).pack(anchor="w", pady=(0, 8))

        ttk.Checkbutton(
            frame,
            text="启用 CUHK Gateway",
            variable=self.gateway_enabled,
            command=self._changed,
        ).pack(anchor="w", pady=(0, 16))

        form = ttk.Frame(frame)
        form.pack(fill="x")
        ttk.Label(form, text="模型", width=10).grid(row=0, column=0, sticky="w", pady=6)
        self.model_box = ttk.Combobox(
            form,
            state="readonly",
            width=32,
            textvariable=self.model_label,
            values=[entry["label"] for entry in MODELS.values()],
        )
        self.model_box.grid(row=0, column=1, sticky="ew", pady=6)
        self.model_box.bind("<<ComboboxSelected>>", self._model_changed)

        ttk.Label(form, text="思考强度", width=10).grid(row=1, column=0, sticky="w", pady=6)
        self.thinking_box = ttk.Combobox(form, state="readonly", width=32, textvariable=self.thinking_label)
        self.thinking_box.grid(row=1, column=1, sticky="ew", pady=6)
        self.thinking_box.bind("<<ComboboxSelected>>", self._changed)
        ttk.Label(form, text="工作目录", width=10).grid(row=2, column=0, sticky="w", pady=6)
        self.workdir_entry = ttk.Entry(form, textvariable=self.workdir_var, state="readonly", width=34)
        self.workdir_entry.grid(row=2, column=1, sticky="we", pady=6)
        ttk.Button(form, text="浏览…", command=self.choose_workdir).grid(row=2, column=2, sticky="w", padx=(8, 0))
        form.columnconfigure(1, weight=1)

        buttons = ttk.Frame(frame)
        buttons.pack(fill="x", pady=(20, 8))
        ttk.Button(buttons, text="保存设置", command=self.save).pack(side="left")
        ttk.Button(buttons, text="检查连接", command=self.check_connection).pack(side="left", padx=8)
        ttk.Button(buttons, text="关闭", command=root.destroy).pack(side="right")
        ttk.Button(
            frame,
            text="启动 Gateway Codex CLI",
            command=self.launch_gateway_codex,
        ).pack(fill="x", pady=(8, 10))
        ttk.Label(frame, textvariable=self.status, style="Status.TLabel").pack(anchor="w")

        self._refresh_thinking()
        self._refresh_enabled_state()

    def _selected_model(self) -> str:
        selected = self.model_label.get()
        return next((key for key, value in MODELS.items() if value["label"] == selected), "glm5.3flash")

    def _refresh_thinking(self) -> None:
        model = self._selected_model()
        levels = MODELS[model]["thinking"]
        if not levels:
            self.thinking_box.configure(values=["/"], state="disabled")
            self.thinking_label.set("/")
            return
        labels = [THINKING_LABELS[level] for level in levels]
        self.thinking_box.configure(values=labels, state="readonly" if self._web_ai_enabled() else "disabled")
        current = self.config.get("thinking") if self.config.get("model") == model else None
        self.thinking_label.set(THINKING_LABELS.get(str(current), labels[0]))

    def _refresh_enabled_state(self) -> None:
        state = "readonly" if self._web_ai_enabled() else "disabled"
        self.model_box.configure(state=state)
        if MODELS[self._selected_model()]["thinking"]:
            self.thinking_box.configure(state=state)

    def _web_ai_enabled(self) -> bool:
        return self.consultation_enabled.get() or self.gateway_enabled.get()

    def _model_changed(self, _event: object = None) -> None:
        self.config["model"] = self._selected_model()
        self.config["thinking"] = None
        self._refresh_thinking()
        self._changed()

    def _changed(self, _event: object = None) -> None:
        self._refresh_enabled_state()
        self.save()

    def _current_config(self) -> dict[str, object]:
        model = self._selected_model()
        reverse = {label: key for key, label in THINKING_LABELS.items()}
        thinking = reverse.get(self.thinking_label.get()) if MODELS[model]["thinking"] else None
        return {
            "consultationEnabled": self.consultation_enabled.get(),
            "gatewayEnabled": self.gateway_enabled.get(),
            "model": model,
            "thinking": thinking,
            "workdir": self.workdir_var.get().strip(),
        }

    def save(self) -> None:
        try:
            self.config = normalize_config(self._current_config())
            save_config(self.config)
            consultation = "开启" if self.config["consultationEnabled"] else "关闭"
            gateway = "开启" if self.config["gatewayEnabled"] else "关闭"
            self.status.set(f"已保存 · 咨询 {consultation} · Gateway {gateway}")
        except OSError as error:
            messagebox.showerror("保存失败", str(error))

    def choose_workdir(self) -> None:
        initial = self.workdir_var.get().strip()
        if not initial or not Path(initial).is_dir():
            initial = str(ROOT)
        chosen = filedialog.askdirectory(title="选择工作目录", initialdir=initial, parent=self.root)
        if chosen:
            self.workdir_var.set(str(Path(chosen)))
            self.save()
            self.status.set("工作目录已保存")


    def check_connection(self) -> None:
        self.status.set("正在检查连接……")
        self.root.update_idletasks()
        try:
            result = subprocess.run(
                [str(OPENCLI), "doctor"],
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=20,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                check=False,
            )
            connected = "[OK] Extension: connected" in result.stdout and "[OK] Connectivity" in result.stdout
            self.status.set("连接正常" if connected else "连接不可用，请确认 Chrome 与扩展已打开")
        except (OSError, subprocess.TimeoutExpired) as error:
            self.status.set(f"检查失败：{error}")

    def launch_gateway_codex(self) -> None:
        try:
            self.gateway_enabled.set(True)
            self.save()
            workdir = str(self.config.get("workdir") or ROOT)
            subprocess.Popen(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(CODEX_LAUNCHER),
                ],
                cwd=workdir,
                creationflags=getattr(subprocess, "CREATE_NEW_CONSOLE", 0),
            )
            self.status.set(f"已打开 Gateway CLI · {workdir}")
        except OSError as error:
            messagebox.showerror("启动失败", str(error))


def main() -> None:
    if "--print-config" in sys.argv:
        print(json.dumps(load_config(), ensure_ascii=False, indent=2))
        return
    root = tk.Tk()
    SettingsApp(root)
    root.mainloop()


if __name__ == "__main__":
    main()
