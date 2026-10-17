from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import settings_app


class FakeVar:
    def __init__(self, value: object) -> None:
        self.value = value

    def get(self) -> object:
        return self.value

    def set(self, value: object) -> None:
        self.value = value


class SettingsConfigTests(unittest.TestCase):
    def test_frozen_panel_uses_installed_application_root(self) -> None:
        with mock.patch.object(settings_app.sys, "frozen", True, create=True), \
             mock.patch.object(settings_app.sys, "executable", r"C:\Users\Example\AppData\Local\Programs\CUHK AI Bridge\app\CUHK-AI-Settings.exe"):
            self.assertEqual(settings_app.application_root(), Path(r"C:\Users\Example\AppData\Local\Programs\CUHK AI Bridge"))

    def test_qwen_local_model_preserves_its_verified_thinking_levels(self) -> None:
        for thinking in ("none", "low", "medium", "xhigh"):
            config = settings_app.normalize_config({"model": "qwen3.8-27b", "thinking": thinking})
            self.assertEqual(config["model"], "qwen3.8-27b")
            self.assertEqual(config["thinking"], thinking)

    def test_normalize_config_preserves_an_existing_workdir(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = settings_app.normalize_config({"workdir": directory})

        self.assertEqual(config["workdir"], directory)

    def test_normalize_config_clears_a_missing_workdir(self) -> None:
        missing = Path(tempfile.gettempdir()) / "cuhk-settings-missing-workdir"
        config = settings_app.normalize_config({"workdir": str(missing)})

        self.assertEqual(config["workdir"], "")

    def test_current_config_includes_the_selected_workdir(self) -> None:
        app = settings_app.SettingsApp.__new__(settings_app.SettingsApp)
        app.gateway_enabled = FakeVar(True)
        app.model_label = FakeVar(settings_app.MODELS["glm5.3flash"]["label"])
        app.thinking_label = FakeVar(settings_app.THINKING_LABELS["high"])
        app.workdir_var = FakeVar(r"D:\Projects\example")

        self.assertEqual(app._current_config()["workdir"], r"D:\Projects\example")

    def test_normalize_config_omits_unknown_settings(self) -> None:
        config = settings_app.normalize_config({"obsoleteSetting": True})

        self.assertNotIn("obsoleteSetting", config)


class SettingsLaunchTests(unittest.TestCase):
    @mock.patch.object(settings_app, "stop_gateway")
    def test_close_waits_for_cleanup_before_destroying_window(self, stop: mock.Mock) -> None:
        app = self.make_app("")
        app.root = mock.Mock()
        order = mock.Mock()
        order.attach_mock(stop, "stop")
        order.attach_mock(app.root.destroy, "destroy")
        app.close()
        self.assertEqual(order.mock_calls, [mock.call.stop(), mock.call.destroy()])

    @mock.patch.object(settings_app.messagebox, "showerror")
    @mock.patch.object(settings_app, "stop_gateway", side_effect=RuntimeError("remaining process"))
    def test_failed_cleanup_keeps_panel_open(self, stop: mock.Mock, error: mock.Mock) -> None:
        app = self.make_app("")
        app.root = mock.Mock()
        app.close()
        app.root.destroy.assert_not_called()
        error.assert_called_once()

    @mock.patch.object(settings_app.subprocess, "Popen")
    def test_actual_buttons_launch_codex_claude_codex_independently(self, popen: mock.Mock) -> None:
        root = settings_app.tk.Tk()
        root.withdraw()
        self.addCleanup(root.destroy)
        with tempfile.TemporaryDirectory() as directory:
            config = settings_app.default_config()
            config["workdir"] = directory
            with mock.patch.object(settings_app, "load_config", return_value=config):
                app = settings_app.SettingsApp(root)
            app.save = mock.Mock()
            buttons = {}
            def visit(widget):
                if isinstance(widget, settings_app.ttk.Button):
                    buttons[widget.cget("text")] = widget
                for child in widget.winfo_children():
                    visit(child)
            visit(root)
            for client in ("Codex", "Claude Code", "Codex"):
                buttons[f"启动 Gateway {client} CLI"].invoke()
        self.assertEqual([call.args[0][-1] for call in popen.call_args_list],
                         [str(settings_app.CODEX_LAUNCHER), str(settings_app.CLAUDE_LAUNCHER),
                          str(settings_app.CODEX_LAUNCHER)])
        self.assertTrue(all(call.kwargs["cwd"] == directory for call in popen.call_args_list))

    @mock.patch.object(settings_app.subprocess, "Popen")
    def test_claude_button_launches_its_own_cli_in_selected_folder(self, popen: mock.Mock) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(directory)
            app.launch_gateway_claude()
        self.assertTrue(app.gateway_enabled.value)
        app.save.assert_called_once_with()
        self.assertEqual(popen.call_args.kwargs["cwd"], directory)
        self.assertIn(str(settings_app.CLAUDE_LAUNCHER), popen.call_args.args[0])
        self.assertNotIn(str(settings_app.CODEX_LAUNCHER), popen.call_args.args[0])

    def test_both_launch_buttons_fit_the_panel(self) -> None:
        root = settings_app.tk.Tk()
        self.addCleanup(root.destroy)
        with mock.patch.object(settings_app, "load_config", return_value=settings_app.default_config()):
            settings_app.SettingsApp(root)
        root.update_idletasks()
        buttons = []
        def visit(widget):
            if isinstance(widget, settings_app.ttk.Button):
                buttons.append(widget)
            for child in widget.winfo_children():
                visit(child)
        visit(root)
        launches = [b for b in buttons if "启动 Gateway" in b.cget("text")]
        self.assertEqual(len(launches), 2)
        for button in launches:
            self.assertLessEqual(button.winfo_rooty() + button.winfo_height(), root.winfo_rooty() + root.winfo_height())

    def test_launcher_uses_native_current_directory_session_filter(self) -> None:
        launcher = settings_app.CODEX_LAUNCHER.read_text(encoding="utf-8")

        self.assertIn("& $codexCommand resume", launcher)
        self.assertNotIn("resume --all", launcher)

    def make_app(self, workdir: str) -> settings_app.SettingsApp:
        app = settings_app.SettingsApp.__new__(settings_app.SettingsApp)
        app.gateway_enabled = FakeVar(False)
        app.config = {"workdir": workdir}
        app.status = FakeVar("")
        app.save = mock.Mock()
        return app

    @mock.patch.object(settings_app.subprocess, "Popen")
    def test_launch_uses_the_selected_workdir(self, popen: mock.Mock) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(directory)
            app.launch_gateway_codex()

        self.assertTrue(app.gateway_enabled.value)
        app.save.assert_called_once_with()
        self.assertEqual(popen.call_args.kwargs["cwd"], directory)
        self.assertIn(str(settings_app.CODEX_LAUNCHER), popen.call_args.args[0])
        self.assertNotIn(str(settings_app.CLAUDE_LAUNCHER), popen.call_args.args[0])

    @mock.patch.object(settings_app.subprocess, "Popen")
    def test_switching_clients_keeps_each_button_routed_to_its_own_launcher(self, popen: mock.Mock) -> None:
        with tempfile.TemporaryDirectory() as directory:
            app = self.make_app(directory)
            app.launch_gateway_claude()
            app.launch_gateway_codex()
            app.launch_gateway_claude()
        self.assertEqual([call.args[0][-1] for call in popen.call_args_list],
                         [str(settings_app.CLAUDE_LAUNCHER), str(settings_app.CODEX_LAUNCHER),
                          str(settings_app.CLAUDE_LAUNCHER)])
        self.assertTrue(all(call.kwargs["cwd"] == directory for call in popen.call_args_list))

    @mock.patch.object(settings_app.subprocess, "Popen")
    def test_launch_without_a_selection_uses_the_bridge_root(self, popen: mock.Mock) -> None:
        app = self.make_app("")
        app.launch_gateway_codex()

        self.assertEqual(popen.call_args.kwargs["cwd"], str(settings_app.ROOT))


if __name__ == "__main__":
    unittest.main()
