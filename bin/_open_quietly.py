#!/usr/bin/env python3
"""Legacy entry point: require Artifact Dock, just like the main CLI.

Old callers must not re-enable the retired AppleScript/browser fallback.
"""
from pathlib import Path
import subprocess
import sys


def main():
    if len(sys.argv) not in (2, 3):
        print('사용법: _open_quietly.py <HTML/URL> [0|1]', file=sys.stderr)
        return 2
    cli = Path(__file__).resolve().with_name('artifact-open')
    flags = ['-f'] if len(sys.argv) == 3 and sys.argv[2] == '1' else []
    return subprocess.run(['/bin/bash', str(cli), *flags, '--', sys.argv[1]]).returncode


if __name__ == '__main__':
    sys.exit(main())
