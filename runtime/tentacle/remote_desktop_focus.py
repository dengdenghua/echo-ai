"""Focused-control metadata only. Never query values, names or password contents."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

_WINDOWS_PROBE = r"""
Add-Type -AssemblyName UIAutomationClient
$e = [System.Windows.Automation.AutomationElement]::FocusedElement
$edit = $false
$secure = $false
if ($null -ne $e) {
  $secure = $e.Current.IsPassword
  $edit = $e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit
  $p = $null
  if ($e.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref]$p)) {
    $edit = -not $p.Current.IsReadOnly
  }
}
@{available=$true;editable=$edit;secure=$secure} | ConvertTo-Json -Compress
"""


def focused_input_hint() -> dict[str, bool]:
    unavailable = {"available": False, "editable": False, "secure": False}
    try:
        if sys.platform == "win32":
            command = [
                "powershell.exe",
                "-NoProfile",
                "-NonInteractive",
                "-Command",
                _WINDOWS_PROBE,
            ]
            startup = subprocess.STARTUPINFO()
            startup.dwFlags |= subprocess.STARTF_USESHOWWINDOW
            startup.wShowWindow = 0
            options = {"startupinfo": startup}
        elif sys.platform.startswith("linux") and os.environ.get("XDG_SESSION_TYPE") != "wayland":
            command = [
                "/usr/bin/python3",
                str(Path(__file__).with_name("remote_desktop_x11_text.py")),
                "--focus",
            ]
            options = {}
        else:
            return unavailable
        result = subprocess.run(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=2,
            check=False,
            **options,
        )
        if result.returncode:
            return unavailable
        value = json.loads(result.stdout)
        if not isinstance(value, dict):
            return unavailable
        return {key: value.get(key) is True for key in unavailable}
    except (OSError, ValueError, subprocess.SubprocessError):
        return unavailable
