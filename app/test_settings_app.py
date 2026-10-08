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

    @mock.patch.object(settings_app.subprocess, "Popen")
    def test_launch_without_a_selection_uses_the_bridge_root(self, popen: mock.Mock) -> None:
        app = self.make_app("")
        app.launch_gateway_codex()

        self.assertEqual(popen.call_args.kwargs["cwd"], str(settings_app.ROOT))


if __name__ == "__main__":
    unittest.main()
