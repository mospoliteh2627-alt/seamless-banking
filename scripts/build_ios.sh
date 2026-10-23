#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT/apps/mobile"
export GEM_HOME="${GEM_HOME:-$ROOT/../.gem-home}"
export GEM_PATH="$GEM_HOME"
export PATH="$GEM_HOME/bin:$PATH"
export LANG=en_US.UTF-8
(cd ios && pod install)
python3 - <<'PY'
from pathlib import Path
for p in Path('ios/Pods').rglob('*'):
    if p.suffix in {'.xcconfig', '.sh'}:
        s = p.read_text(errors='ignore')
        if 'DT_TOOLCHAIN_DIR' in s:
            p.write_text(s.replace('DT_TOOLCHAIN_DIR', 'TOOLCHAIN_DIR'))
PY
"$ROOT/../scripts/flutter.sh" build ios --release --no-codesign
