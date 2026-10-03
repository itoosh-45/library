"""Pack a pending candidate and verify its exact tested files before a manual Pages deployment."""
import argparse
import gzip
import hashlib
import io
import json
import re
import tarfile
from ipaddress import ip_address
from html.parser import HTMLParser
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

MAX_FILE = 5 * 1024 * 1024
MAX_TOTAL = 20 * 1024 * 1024
REQUIRED_TESTS = {f"T{number:02}" for number in range(1, 31)} - {"T28"}
REQUIRED_FILES = {"index.html", "manifest.webmanifest", "service-worker.js"}
OCR_FILES = {"ocr/worker.min.js", "ocr/tesseract-core-lstm.wasm.js", "ocr/tesseract-core-lstm.wasm", "ocr/heb.traineddata.gz", "ocr/eng.traineddata.gz", "ocr/LICENSE.tessdata.txt", "ocr/LICENSE.tesseract.txt"}
ROOT_FIELDS = {"format", "testedCommit", "appVersion", "schemaVersion", "backupVersion", "basePath", "artifactSha256", "stagingOrigin", "freeOnly", "userReady", "oracleApplicable", "tests", "files"}
SECRET = re.compile(rb"AIza[A-Za-z0-9_-]{20,}|sk-proj-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA )?PRIVATE KEY-----|SECRET-CANARY")


def safe_name(name):
    if not isinstance(name, str) or len(name) > 240 or not re.fullmatch(r"[A-Za-z0-9_./-]+", name):
        raise ValueError("Invalid candidate file name")
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or str(path) != name:
        raise ValueError("Invalid candidate file path")
    root_files = REQUIRED_FILES | {".nojekyll"}
    allowed = name in root_files or name in OCR_FILES or (
        len(path.parts) == 2 and path.parts[0] in {"assets", "icons", "fonts", "templates"}
        and path.suffix in {".js", ".css", ".png", ".svg", ".ico", ".ttf", ".woff2", ".txt", ".xlsx"}
    )
    if not allowed:
        raise ValueError("Non-product file in candidate")
    return name


def sha(data):
    return hashlib.sha256(data).hexdigest()


def json_unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate manifest property")
        result[key] = value
    return result


def read_acceptance(path):
    data = Path(path).read_bytes()
    if len(data) > 128 * 1024 or SECRET.search(data):
        raise ValueError("Unsafe acceptance file")
    return json.loads(data, object_pairs_hook=json_unique)


def validate_acceptance(value, commit):
    if not isinstance(value, dict) or set(value) != ROOT_FIELDS or value["format"] != "library-candidate-1":
        raise ValueError("Unsupported acceptance format")
    if not re.fullmatch(r"[a-f0-9]{40}", commit) or value["testedCommit"] != commit:
        raise ValueError("Candidate commit differs from tested commit")
    if not isinstance(value["appVersion"], str) or not re.fullmatch(r"\d+\.\d+\.\d+", value["appVersion"]) or value["schemaVersion"] != 2 or value["backupVersion"] != 8 or value["basePath"] != "/library/":
        raise ValueError("Unsupported candidate compatibility")
    if value["freeOnly"] is not True or value["userReady"] is not True or type(value["oracleApplicable"]) is not bool:
        raise ValueError("Candidate acceptance is incomplete")
    if not isinstance(value["stagingOrigin"], str):
        raise ValueError("Missing isolated HTTPS staging")
    origin = urlsplit(value["stagingOrigin"])
    hostname = (origin.hostname or "").lower().rstrip(".")
    try:
        address = ip_address(hostname); local = address.is_loopback or address.is_unspecified
    except ValueError:
        local = hostname == "localhost" or hostname.endswith(".localhost")
    if origin.scheme != "https" or not hostname or local or origin.username or origin.password or origin.port == 0 or origin.path not in {"", "/"} or origin.query or origin.fragment or hostname == "itoosh-45.github.io":
        raise ValueError("Missing isolated HTTPS staging")
    tests = value["tests"]
    if not isinstance(tests, dict) or set(tests) != REQUIRED_TESTS:
        raise ValueError("Incomplete candidate test matrix")
    for name, evidence in tests.items():
        if not isinstance(evidence, dict) or set(evidence) != {"status", "evidence"} or not isinstance(evidence["evidence"], str) or not evidence["evidence"].strip() or len(evidence["evidence"]) > 2048:
            raise ValueError("Missing test evidence")
        conditional = name in {"T07", "T26"} and value["oracleApplicable"] is False
        if evidence["status"] != "PASS" and not (conditional and evidence["status"] == "N/A"):
            raise ValueError("Candidate test has not passed")
    if not isinstance(value["artifactSha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["artifactSha256"]):
        raise ValueError("Missing artifact checksum")
    files = value["files"]
    if not isinstance(files, dict) or not 3 <= len(files) <= 128 or not REQUIRED_FILES <= set(files):
        raise ValueError("Incomplete candidate files")
    folded, total = set(), 0
    for name, item in files.items():
        safe_name(name)
        if name.casefold() in folded or not isinstance(item, dict) or set(item) != {"sha256", "bytes"} or type(item["bytes"]) is not int or not 0 <= item["bytes"] <= MAX_FILE or not isinstance(item["sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", item["sha256"]):
            raise ValueError("Invalid file manifest")
        folded.add(name.casefold()); total += item["bytes"]
    if total > MAX_TOTAL:
        raise ValueError("Candidate exceeds size budget")


class PolicyParser(HTMLParser):
    def __init__(self):
        super().__init__(); self.policies = []; self.script_before_policy = False

    def handle_starttag(self, tag, attributes):
        values = dict(attributes)
        if tag == "script" and not self.policies:
            self.script_before_policy = True
        if tag == "meta" and (values.get("http-equiv") or "").lower() == "content-security-policy":
            self.policies.append(values.get("content") or "")


def inside_workspace(path):
    resolved = Path(path).resolve()
    if resolved == Path.cwd().resolve() or not resolved.is_relative_to(Path.cwd().resolve()):
        raise ValueError("Output must stay inside the current workspace")
    return resolved


def verify(acceptance, archive, commit, destination):
    value = read_acceptance(acceptance); validate_acceptance(value, commit)
    archive = Path(archive)
    if archive.stat().st_size > MAX_TOTAL or sha(archive.read_bytes()) != value["artifactSha256"]:
        raise ValueError("Candidate archive checksum differs")
    bodies = {}
    with gzip.open(archive, "rb") as compressed:
        expanded = compressed.read(MAX_TOTAL + 1024 * 1024 + 1)
    if len(expanded) > MAX_TOTAL + 1024 * 1024:
        raise ValueError("Expanded archive exceeds size budget")
    end = 0
    with tarfile.open(fileobj=io.BytesIO(expanded), mode="r:") as members:
        for member in members:
            name = safe_name(member.name)
            if name in bodies or name not in value["files"] or not member.isfile() or member.sparse is not None or member.pax_headers or member.size != value["files"][name]["bytes"]:
                raise ValueError("Unexpected archive member")
            body = members.extractfile(member).read(MAX_FILE + 1)
            if len(body) != member.size or sha(body) != value["files"][name]["sha256"] or SECRET.search(body):
                raise ValueError("Unsafe or changed candidate file")
            bodies[name] = body; end = member.offset_data + ((member.size + 511) // 512) * 512
    if any(expanded[end:]):
        raise ValueError("Unexpected archive trailer")
    if set(bodies) != set(value["files"]):
        raise ValueError("Missing candidate archive member")
    policy = PolicyParser(); policy.feed(bodies["index.html"].decode("utf8"))
    directives = [part.strip().split() for part in policy.policies[0].split(";")] if len(policy.policies) == 1 else []
    if policy.script_before_policy or [part for part in directives if part and part[0] == "script-src"] != [["script-src", "'self'"]]:
        raise ValueError("Candidate has no required production CSP")
    manifest = json.loads(bodies["manifest.webmanifest"])
    if any(manifest.get(key) != "./" for key in ["id", "start_url", "scope"]):
        raise ValueError("Candidate manifest scope differs")
    output = inside_workspace(destination)
    output.mkdir(parents=True, exist_ok=False)
    for name, body in bodies.items():
        target = output / name; target.parent.mkdir(parents=True, exist_ok=True); target.write_bytes(body)
    return value


def pack(source, archive, acceptance, commit, version):
    source = Path(source).resolve(); archive = inside_workspace(archive); acceptance = inside_workspace(acceptance)
    if archive.exists() or acceptance.exists():
        raise ValueError("Preserve the existing snapshot; choose new output paths")
    bodies = {}
    for file in sorted(source.rglob("*")):
        if file.is_symlink():
            raise ValueError("Candidate source contains a symlink")
        if file.is_file():
            name = safe_name(file.relative_to(source).as_posix())
            if file.stat().st_size > MAX_FILE or len(bodies) >= 128:
                raise ValueError("Candidate exceeds size budget")
            body = file.read_bytes()
            if SECRET.search(body):
                raise ValueError("Candidate contains a secret pattern")
            bodies[name] = body
    if not REQUIRED_FILES <= set(bodies) or sum(map(len, bodies.values())) > MAX_TOTAL:
        raise ValueError("Incomplete or oversized candidate build")
    archive.parent.mkdir(parents=True, exist_ok=True)
    with archive.open("xb") as target:
        with gzip.GzipFile(fileobj=target, mode="wb", mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as output:
                for name, body in bodies.items():
                    member = tarfile.TarInfo(name); member.size = len(body); member.mode = 0o644; output.addfile(member, io.BytesIO(body))
    pending = {"format": "library-candidate-1", "testedCommit": commit, "appVersion": version, "schemaVersion": 2, "backupVersion": 8, "basePath": "/library/", "artifactSha256": sha(archive.read_bytes()), "stagingOrigin": "", "freeOnly": True, "userReady": False, "oracleApplicable": True, "tests": {name: {"status": "NOT RUN", "evidence": ""} for name in sorted(REQUIRED_TESTS)}, "files": {name: {"bytes": len(body), "sha256": sha(body)} for name, body in bodies.items()}}
    acceptance.parent.mkdir(parents=True, exist_ok=True)
    with acceptance.open("x", encoding="utf8") as target:
        json.dump(pending, target, ensure_ascii=False, indent=2); target.write("\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(); sub = parser.add_subparsers(dest="mode", required=True)
    packing = sub.add_parser("pack")
    for name in ["source", "archive", "acceptance", "commit", "version"]:
        packing.add_argument(name)
    checking = sub.add_parser("verify")
    for name in ["acceptance", "archive", "commit", "destination"]:
        checking.add_argument(name)
    arguments = vars(parser.parse_args()); mode = arguments.pop("mode")
    try:
        if mode == "pack":
            pack(**arguments); print("Pending candidate packed; no acceptance or deployment is implied.")
        else:
            verify(**arguments); print("Candidate metadata and exact artifact verified; human evidence remains an owner responsibility.")
    except (ValueError, OSError, EOFError, tarfile.TarError, json.JSONDecodeError):
        raise SystemExit("Candidate gate rejected the input; nothing was deployed.")
