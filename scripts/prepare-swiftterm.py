#!/usr/bin/env python3
"""Adapt the pinned SwiftPM dependency to resources inside a signed app bundle."""
from pathlib import Path
import stat
import sys
root = Path(__file__).resolve().parent.parent
scratch = Path(sys.argv[1]) if len(sys.argv) > 1 else root / 'app/.build'
source = scratch / 'checkouts/SwiftTerm/Sources/SwiftTerm/Apple/Metal/MetalTerminalRenderer.swift'
old = '        bundles.append(Bundle.module)'
new = '''        if let url = Bundle.main.url(forResource: "SwiftTerm_SwiftTerm", withExtension: "bundle"),
           let resources = Bundle(url: url) {
            bundles.append(resources)
        } else {
            bundles.append(Bundle.module)
        }'''
text = source.read_text()
if new not in text:
    if text.count(old) != 1:
        raise SystemExit('SwiftTerm resource lookup changed; review packaging before releasing')
    source.chmod(source.stat().st_mode | stat.S_IWUSR)
    source.write_text(text.replace(old, new))
