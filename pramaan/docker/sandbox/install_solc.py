"""Download pinned solc builds into an svm-style directory, verifying each binary's sha256 from soliditylang.org."""
import hashlib
import json
import os
import sys
import urllib.request

BASE = "https://binaries.soliditylang.org/linux-amd64"
# The CDN rejects Python's default "Python-urllib/x.y" agent with 403.
HEADERS = {"User-Agent": "pramaan-sandbox-build/0.1 (+https://github.com/pramaan-dev/pramaan)"}


def fetch(url: str, timeout: int) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=timeout) as r:
        return r.read()


def main(target: str, versions: list[str]) -> None:
    builds = {b["version"]: b for b in json.loads(fetch(f"{BASE}/list.json", 60))["builds"] if "nightly" not in b.get("longVersion", "")}
    for version in versions:
        build = builds.get(version)
        if not build:
            raise SystemExit(f"solc {version} not in list.json")
        data = fetch(f"{BASE}/{build['path']}", 300)
        digest = hashlib.sha256(data).hexdigest()
        expected = build["sha256"].removeprefix("0x")
        if digest != expected:
            raise SystemExit(f"solc {version}: sha256 {digest} != {expected}")
        directory = os.path.join(target, version)
        os.makedirs(directory, exist_ok=True)
        path = os.path.join(directory, f"solc-{version}")
        with open(path, "wb") as f:
            f.write(data)
        os.chmod(path, 0o755)
        print(f"solc {version} ok ({digest[:16]})")
    os.chmod(target, 0o755)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
