"""Pramaan sandbox runner.

Runs INSIDE the network-less analysis container as an unprivileged user. The repository is mounted read-only at /src
and copied into a tmpfs at /work; generated exploit tests (if any) are mounted read-only at /inputs. The runner prints
exactly one JSON document after RESULT_MARKER on stdout. Everything it reports comes from the tools' own output.

  analyze                 Slither (+ Pramaan detectors), Aderyn, forge build with AST
  test [--suite]          run test/pramaan/* exploit tests (and optionally the project's own suite)
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import time

RESULT_MARKER = "@@PRAMAAN_RESULT@@"
SRC = "/src"
INPUTS = "/inputs"
WORK = "/work"
MAX_CAPTURE = 1_500_000
COPY_IGNORE = shutil.ignore_patterns(".git", "out", "cache", "broadcast", "crytic-export", "*.log")


def log(msg):
    print(f"[pramaan-sandbox] {msg}", file=sys.stderr, flush=True)


def prepare_home():
    home = os.environ.get("HOME", "/work/home")
    os.makedirs(home, exist_ok=True)
    svm = os.path.join(home, ".svm")
    if not os.path.exists(svm):
        os.symlink("/opt/svm", svm)


def copy_repo(dest):
    if os.path.exists(dest):
        shutil.rmtree(dest)
    # symlinks=True keeps links as links (pointing nowhere useful inside the container) instead of following them.
    shutil.copytree(SRC, dest, symlinks=True, ignore=COPY_IGNORE)
    sanitize_project(dest)
    return dest


# foundry.toml keys that only affect compilation/test layout. Everything else (ffi, fs_permissions, rpc_endpoints,
# etherscan, profiles other than default, ...) is dropped: the repository is untrusted and FOUNDRY_* environment
# variables do NOT reliably override settings in the file (verified: FOUNDRY_FFI=false did not disable ffi = true).
SAFE_PROFILE_KEYS = {
    "src": str, "test": str, "script": str, "out": str, "libs": list, "remappings": list, "auto_detect_remappings": bool,
    "solc": str, "solc_version": str, "auto_detect_solc": bool, "evm_version": str, "optimizer": bool, "optimizer_runs": int,
    "via_ir": bool, "bytecode_hash": str, "cbor_metadata": bool, "allow_paths": list, "include_paths": list,
    "libraries": list, "ignored_error_codes": list, "deny_warnings": bool, "use_literal_content": bool,
    "gas_limit": (int, str), "isolate": bool,
}
SAFE_FUZZ_KEYS = {"runs": int, "max_test_rejects": int, "seed": str}


def toml_value(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, str):
        return json.dumps(v)
    if isinstance(v, list):
        return "[" + ", ".join(toml_value(x) for x in v if isinstance(x, (str, int, bool))) + "]"
    raise ValueError("unsupported")


def sanitize_project(repo):
    """Rewrites foundry.toml from an allowlist (forcing ffi = false) and removes .env files Foundry would auto-load."""
    import tomllib

    for name in (".env", ".env.local"):
        try:
            os.remove(os.path.join(repo, name))
        except OSError:
            pass
    path = os.path.join(repo, "foundry.toml")
    data = {}
    if os.path.exists(path):
        try:
            with open(path, "rb") as f:
                data = tomllib.load(f)
        except (OSError, tomllib.TOMLDecodeError) as exc:
            log(f"foundry.toml could not be parsed ({exc}); using defaults")
    profile = (data.get("profile") or {}).get("default") or {}
    lines = ["# Rewritten by the Pramaan sandbox: only layout/compiler keys are kept and ffi is always off.", "[profile.default]"]
    for key, kind in SAFE_PROFILE_KEYS.items():
        if key in profile and isinstance(profile[key], kind):
            lines.append(f"{key} = {toml_value(profile[key])}")
    lines += ["ffi = false", "fs_permissions = []", ""]
    fuzz = profile.get("fuzz") if isinstance(profile.get("fuzz"), dict) else data.get("fuzz") if isinstance(data.get("fuzz"), dict) else {}
    kept = [(k, min(v, 1000) if k == "runs" else v) for k, v in fuzz.items() if k in SAFE_FUZZ_KEYS and isinstance(v, SAFE_FUZZ_KEYS[k])]
    if kept:
        lines.append("[fuzz]")
        lines += [f"{k} = {toml_value(v)}" for k, v in kept]
        lines.append("")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    os.environ["FOUNDRY_PROFILE"] = "default"


def run(cmd, cwd, timeout):
    started = time.time()
    try:
        p = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout, errors="replace")
        code, out, err = p.returncode, p.stdout, p.stderr
    except subprocess.TimeoutExpired as exc:
        code, out, err = -9, (exc.stdout or b"").decode("utf-8", "replace") if isinstance(exc.stdout, bytes) else (exc.stdout or ""), f"timed out after {timeout}s"
    except FileNotFoundError as exc:
        code, out, err = -2, "", str(exc)
    return {
        "cmd": cmd,
        "exitCode": code,
        "stdout": out[-MAX_CAPTURE:],
        "stderr": err[-MAX_CAPTURE:],
        "durationMs": int((time.time() - started) * 1000),
    }


def first_line(cmd):
    r = run(cmd, WORK, 60)
    text = (r["stdout"] or r["stderr"]).strip().splitlines()
    return text[0].strip() if text else "unknown"


def tool_versions():
    solcs = sorted(d for d in os.listdir("/opt/svm") if not d.startswith("."))
    return [
        {"name": "forge", "version": first_line(["forge", "--version"])},
        {"name": "slither", "version": first_line(["slither", "--version"])},
        {"name": "aderyn", "version": first_line(["aderyn", "--version"])},
        {"name": "solc", "version": ",".join(solcs)},
        {"name": "pramaan-sandbox", "version": os.environ.get("PRAMAAN_SANDBOX_VERSION", "1")},
    ]


def parse_json_tail(text):
    """forge/slither print one JSON document; tolerate leading log lines."""
    text = text.strip()
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        while start != -1:
            try:
                return json.loads(text[start:])
            except json.JSONDecodeError:
                start = text.find("{", start + 1)
    return None


def line_of(source_bytes, offset):
    return source_bytes.count(b"\n", 0, offset) + 1


def collect_artifacts(repo):
    """Contract inventory from forge artifacts + AST: ABI, deployability, inheritance and function source spans."""
    names_by_id = {}
    raw = []
    for path in glob.glob(os.path.join(repo, "out", "**", "*.json"), recursive=True):
        if f"{os.sep}build-info{os.sep}" in path:
            continue
        try:
            with open(path, "r", encoding="utf-8") as f:
                art = json.load(f)
        except (OSError, json.JSONDecodeError):
            continue
        ast = art.get("ast") or {}
        for node in ast.get("nodes", []):
            if node.get("nodeType") == "ContractDefinition":
                names_by_id[node.get("id")] = node.get("name")
        raw.append((path, art, ast))

    contracts = []
    sources_cache = {}
    for path, art, ast in raw:
        name = os.path.splitext(os.path.basename(path))[0]
        source = ast.get("absolutePath")
        if not source:
            continue
        node = next((n for n in ast.get("nodes", []) if n.get("nodeType") == "ContractDefinition" and n.get("name") == name), None)
        if node is None:
            continue
        if source not in sources_cache:
            try:
                with open(os.path.join(repo, source), "rb") as f:
                    sources_cache[source] = f.read()
            except OSError:
                sources_cache[source] = b""
        src_bytes = sources_cache[source]
        functions = []
        for fn in node.get("nodes", []):
            if fn.get("nodeType") != "FunctionDefinition":
                continue
            start, length, _ = (int(x) for x in fn.get("src", "0:0:0").split(":"))
            body = fn.get("body") or {}
            body_start = int(body.get("src", "0:0:0").split(":")[0]) if body else None
            functions.append({
                "name": fn.get("name") or fn.get("kind"),
                "kind": fn.get("kind"),
                "visibility": fn.get("visibility"),
                "stateMutability": fn.get("stateMutability"),
                "modifiers": [((m.get("modifierName") or {}).get("name")) for m in fn.get("modifiers", [])],
                "parameters": [
                    {"name": p.get("name"), "type": (p.get("typeDescriptions") or {}).get("typeString")}
                    for p in (fn.get("parameters") or {}).get("parameters", [])
                ],
                "src": {"start": start, "length": length, "bodyStart": body_start},
                "lines": [line_of(src_bytes, start), line_of(src_bytes, start + length)],
            })
        bytecode = (art.get("bytecode") or {}).get("object") or "0x"
        contracts.append({
            "name": name,
            "source": source,
            "kind": node.get("contractKind"),
            "abstract": bool(node.get("abstract")),
            "bases": [names_by_id.get(i) for i in node.get("linearizedBaseContracts", []) if names_by_id.get(i) and names_by_id.get(i) != name],
            "deployable": len(bytecode) > 2,
            "abi": art.get("abi") or [],
            "functions": functions,
        })
    return contracts


def cmd_analyze(args):
    prepare_home()
    result = {"mode": "analyze", "tools": tool_versions()}

    # Slither runs `forge clean` and its own sources-only build, so give it its own copy.
    slither_repo = copy_repo(os.path.join(WORK, "slither"))
    sl = run([
        "slither", ".", "--json", "-",
        "--filter-paths", "lib/|test/|script/|node_modules/",
        "--exclude-informational", "--exclude-optimization", "--disable-color",
    ], slither_repo, args.timeout)
    sl_json = parse_json_tail(sl["stdout"])
    result["slither"] = {
        "ok": bool(sl_json and sl_json.get("success")),
        "error": (sl_json or {}).get("error") or (None if sl_json else sl["stderr"][-4000:]),
        "detectors": ((sl_json or {}).get("results") or {}).get("detectors", []),
        "durationMs": sl["durationMs"],
    }
    shutil.rmtree(slither_repo, ignore_errors=True)

    repo = copy_repo(os.path.join(WORK, "repo"))
    build = run(["forge", "build", "--offline", "--ast", "--force"], repo, args.timeout)
    result["build"] = {"ok": build["exitCode"] == 0, "exitCode": build["exitCode"], "log": (build["stdout"] + build["stderr"])[-20000:], "durationMs": build["durationMs"]}
    result["contracts"] = collect_artifacts(repo) if build["exitCode"] == 0 else []

    if not args.skip_aderyn:
        report = os.path.join(WORK, "aderyn.json")
        ad = run(["aderyn", ".", "--output", report, "--no-snippets", "--skip-update-check"], repo, args.timeout)
        try:
            with open(report, "r", encoding="utf-8") as f:
                result["aderyn"] = {"ok": True, "report": json.load(f), "durationMs": ad["durationMs"]}
        except (OSError, json.JSONDecodeError):
            result["aderyn"] = {"ok": False, "error": (ad["stderr"] or ad["stdout"])[-4000:], "durationMs": ad["durationMs"]}
    emit(result)


def cmd_test(args):
    prepare_home()
    repo = copy_repo(os.path.join(WORK, "repo"))
    shutil.copytree("/opt/pramaan/forge-std", os.path.join(repo, "lib", "pramaan-forge-std"), dirs_exist_ok=True)
    tests_dir = os.path.join(repo, "test", "pramaan")
    if os.path.exists(tests_dir):
        shutil.rmtree(tests_dir)
    os.makedirs(tests_dir)
    copied = []
    for path in sorted(glob.glob(os.path.join(INPUTS, "tests", "*.t.sol"))):
        shutil.copy(path, tests_dir)
        copied.append(os.path.basename(path))
    result = {"mode": "test", "tools": tool_versions(), "tests": copied}
    if copied:
        ex = run(["forge", "test", "--offline", "--json", "--match-path", "test/pramaan/*", "-vvv"], repo, args.timeout)
        result["exploit"] = {"exitCode": ex["exitCode"], "json": parse_json_tail(ex["stdout"]), "log": ex["stderr"][-20000:], "durationMs": ex["durationMs"]}
    if args.suite:
        su = run(["forge", "test", "--offline", "--json", "--no-match-path", args.suite_exclude], repo, args.timeout)
        result["suite"] = {"exitCode": su["exitCode"], "json": parse_json_tail(su["stdout"]), "log": su["stderr"][-20000:], "durationMs": su["durationMs"]}
    emit(result)


def emit(result):
    sys.stdout.write(RESULT_MARKER + json.dumps(result) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("analyze")
    a.add_argument("--timeout", type=int, default=480)
    a.add_argument("--skip-aderyn", action="store_true")
    t = sub.add_parser("test")
    t.add_argument("--timeout", type=int, default=480)
    t.add_argument("--suite", action="store_true")
    t.add_argument("--suite-exclude", default="test/pramaan/*")
    args = parser.parse_args()
    {"analyze": cmd_analyze, "test": cmd_test}[args.cmd](args)


if __name__ == "__main__":
    main()
