"""Regression tests: never launch a browser, even when the old fallback runs."""
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
CLI = ROOT / 'bin/artifact-open'
WRAPPER = ROOT / 'bin/open'


class OpenGuard(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='dock-guard-', dir='/tmp')
        self.addCleanup(self.tmp.cleanup)
        self.directory = Path(self.tmp.name)
        self.trace = self.directory / 'calls'
        self.html = self.directory / '한글 보고서.HTML'
        self.html.write_text('<h1>test</h1>')
        self.env = dict(os.environ, ARTIFACT_DOCK_SOCKET=str(self.directory / 'missing.sock'))
        # An old AppleScript/open fallback gets a harmless recorder, never the real tools.
        for name in ['open', 'osascript', 'pgrep']:
            executable = self.directory / name
            executable.write_text(f'#!/bin/sh\necho {name} >> "{self.trace}"\nexit 1\n')
            executable.chmod(0o755)
        self.env['PATH'] = str(self.directory) + os.pathsep + os.environ['PATH']

    def run_cli(self, *args):
        return subprocess.run(['/bin/bash', str(CLI), *map(str, args)], env=self.env,
                              capture_output=True, text=True, timeout=15)

    def test_missing_extension_stops_without_fallback(self):
        result = self.run_cli(self.html)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.trace.exists(), 'No open/osascript/pgrep fallback may run')
        self.assertIn('직접 열지', result.stderr)

    def test_quiet_mode_still_fails(self):
        result = self.run_cli('-q', self.html)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.trace.exists())

    def test_socket_reply(self):
        for reply, foreground, expected in [({'ok': True}, False, 0), ({'ok': True}, True, 0),
                                            ({'ok': False, 'error': 'extension offline'}, False, 3),
                                            ({'ok': 'false'}, False, 3), ({}, False, 3)]:
            with self.subTest(reply=reply, foreground=foreground):
                sockpath = self.directory / 'reply.sock'
                if sockpath.exists(): sockpath.unlink()
                server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                server.bind(str(sockpath)); server.listen(1); server.settimeout(10)
                received = []
                def respond():
                    try:
                        conn, _ = server.accept()
                        with conn:
                            received.append(json.loads(conn.makefile('r').readline()))
                            conn.sendall((json.dumps(reply) + '\n').encode())
                    finally: server.close()
                worker = threading.Thread(target=respond, daemon=True); worker.start()
                self.env['ARTIFACT_DOCK_SOCKET'] = str(sockpath)
                result = self.run_cli(*(['-f'] if foreground else []), self.html)
                worker.join(timeout=10)
                self.assertEqual(result.returncode, expected, result.stderr)
                self.assertEqual(received[0]['activate'], foreground)
                self.assertEqual(received[0]['url'], self.html.as_uri())
                self.assertFalse(self.trace.exists())

    def load_wrapper(self):
        loader = importlib.machinery.SourceFileLoader('dock_open_test', str(WRAPPER))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        module = importlib.util.module_from_spec(spec); loader.exec_module(module)
        return module

    def test_html_detection(self):
        module = self.load_wrapper()
        for target in [str(self.html), 'x.htm', 'x.HtMl', 'file:///tmp/a%20b.HTML#view',
                       'https://example.test/report.html?q=1#part', 'report#part.html']:
            with self.subTest(target=target): self.assertTrue(module.is_html(target))
        for target in ['notes.txt', 'folder.html/image.png', 'https://example.test/api?name=x.html']:
            with self.subTest(target=target): self.assertFalse(module.is_html(target))

    def test_native_non_html_arguments_are_unchanged(self):
        module = self.load_wrapper()
        args = ['-a', 'Preview', 'file with spaces.pdf']
        with patch.object(module.os, 'execv') as native:
            module.main(args)
        native.assert_called_once_with('/usr/bin/open', ['/usr/bin/open', *args])

    def test_invalid_html_options_and_mixed_files_fail_before_opening(self):
        module = self.load_wrapper()
        for args in [['-W', str(self.html)], [str(self.html), 'notes.pdf'], ['-a', str(self.html)],
                     ['--args', str(self.html)]]:
            with self.subTest(args=args), patch.object(module.os, 'execv') as native:
                self.assertNotEqual(module.main(args), 0)
                native.assert_not_called()

    def test_node_and_noninteractive_shell_find_wrapper(self):
        # Put the real wrapper ahead of the forbidden-open recorder.
        bindir = self.directory / 'bin'; bindir.mkdir()
        (bindir / 'open').symlink_to(WRAPPER)
        fake = bindir / 'artifact-open'
        fake.write_text(f'#!{sys.executable}\nimport json,sys\nopen({str(self.trace)!r},"w").write(json.dumps(sys.argv[1:]))\nsys.exit(17 if "--fail" in sys.argv else 0)\n')
        fake.chmod(0o755)
        self.env['PATH'] = str(bindir) + os.pathsep + self.env['PATH']
        commands = [['node', '-e', 'require("node:child_process").execFileSync("open",process.argv.slice(1));', str(self.html)],
                    ['/bin/zsh', '-f', '-c', 'open -g -a "Google Chrome" "$1"', 'test', str(self.html)]]
        for cmd in commands:
            with self.subTest(cmd=cmd):
                result = subprocess.run(cmd, env=self.env, capture_output=True, text=True, timeout=15)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(self.trace.read_text()), ['--', str(self.html)])
                self.trace.unlink()
        fake.write_text('#!/bin/sh\nexit 23\n')
        result = subprocess.run(commands[0], env=self.env, capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.trace.exists())


    def test_legacy_helper_cannot_reenable_fallback(self):
        result = subprocess.run([sys.executable, str(ROOT / 'bin/_open_quietly.py'), str(self.html)],
                                env=self.env, capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.trace.exists())

    def test_cli_only_install_is_idempotent_and_preserves_existing_files(self):
        bindir = self.directory / 'installed'
        env = dict(self.env, ARTIFACT_DOCK_BIN=str(bindir))
        command = ['/bin/bash', str(ROOT / 'install.sh'), '--cli-only']
        for _ in range(2):
            result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((bindir / 'open').resolve(), WRAPPER)
        self.assertEqual((bindir / 'artifact-open').resolve(), CLI)
        (bindir / 'open').unlink()
        (bindir / 'open').write_text('user-owned executable')
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=15)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((bindir / 'open').read_text(), 'user-owned executable')

    def test_missing_artifact_open_never_runs_system_opener(self):
        module = self.load_wrapper()
        with patch.object(module.shutil, 'which', return_value=None), patch.object(module.os, 'execv') as native:
            self.assertNotEqual(module.main([str(self.html)]), 0)
            native.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
