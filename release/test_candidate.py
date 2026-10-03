"""Synthetic release-gate fixtures: no claim about a real candidate or provider."""
import copy
import gzip
import io
import json
import tarfile
import tempfile
import unittest
from pathlib import Path

from candidate import REQUIRED_TESTS, pack, sha, validate_acceptance, verify

COMMIT = "a" * 40


class OcrAssetNames(unittest.TestCase):
    def test_only_fixed_local_ocr_assets_are_product_files(self):
        from candidate import safe_name, OCR_FILES
        for name in OCR_FILES:
            self.assertEqual(safe_name(name), name)
        for name in ["ocr/secret.txt", "ocr/other.wasm", "ocr/../worker.min.js", "ocr/user-photo.jpg"]:
            with self.assertRaises(ValueError):
                safe_name(name)


class CandidateGateTests(unittest.TestCase):
    def setUp(self):
        base = Path("private/phase20-tests").resolve(); base.mkdir(parents=True, exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=base)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"; self.source.mkdir()
        self.bodies = {
            "index.html": b'<meta http-equiv="Content-Security-Policy" content="script-src \'self\';">',
            "manifest.webmanifest": b'{"id":"./","start_url":"./","scope":"./"}',
            "service-worker.js": b"/* synthetic worker */",
            "assets/synthetic.js": b"/* synthetic application */",
        }
        for name, body in self.bodies.items():
            file = self.source / name; file.parent.mkdir(parents=True, exist_ok=True); file.write_bytes(body)
        self.archive, self.acceptance = self.root / "site.tar.gz", self.root / "acceptance.json"
        pack(self.source, self.archive, self.acceptance, COMMIT, "0.16.0")
        self.value = json.loads(self.acceptance.read_text())
        self.value.update(userReady=True, stagingOrigin="https://staging.example.test")
        self.value["tests"] = {name: {"status": "PASS", "evidence": "SYNTHETIC fixture only"} for name in REQUIRED_TESTS}
        self.save()

    def tearDown(self):
        # TemporaryDirectory was created and resolved within the explicit private fixture root.
        expected = Path("private/phase20-tests").resolve()
        if self.root.parent != expected:
            raise RuntimeError("Unexpected cleanup path")
        self.temporary.cleanup()

    def save(self):
        self.acceptance.write_text(json.dumps(self.value), encoding="utf8")

    def rewrite_archive(self, members):
        with gzip.open(self.archive, "wb") as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.USTAR_FORMAT) as archive:
                for member, body in members:
                    archive.addfile(member, io.BytesIO(body) if member.isfile() else None)
        self.value["artifactSha256"] = sha(self.archive.read_bytes()); self.save()

    def test_exact_artifact_round_trip_and_refusal_to_overwrite(self):
        output = self.root / "verified"
        verify(self.acceptance, self.archive, COMMIT, output)
        for name, body in self.bodies.items():
            self.assertEqual((output / name).read_bytes(), body)
        with self.assertRaises(FileExistsError):
            verify(self.acceptance, self.archive, COMMIT, output)
        with self.assertRaises(ValueError):
            pack(self.source, self.archive, self.acceptance, COMMIT, "0.16.0")

    def test_pending_missing_failed_and_unproven_acceptance_is_rejected(self):
        for field, value in [("userReady", False), ("userReady", "true"), ("freeOnly", False), ("testedCommit", "b" * 40), ("stagingOrigin", "http://localhost:4335"), ("stagingOrigin", "https://itoosh-45.github.io/")]:
            with self.subTest(field=field, value=value):
                changed = copy.deepcopy(self.value); changed[field] = value
                with self.assertRaises(ValueError):
                    validate_acceptance(changed, COMMIT)
        for status in ["NOT RUN", "BLOCKED", "FAIL", "N/A"]:
            changed = copy.deepcopy(self.value); changed["tests"]["T03"]["status"] = status
            with self.assertRaises(ValueError):
                validate_acceptance(changed, COMMIT)
        changed = copy.deepcopy(self.value); del changed["tests"]["T27"]
        with self.assertRaises(ValueError):
            validate_acceptance(changed, COMMIT)
        changed = copy.deepcopy(self.value); changed["tests"]["T25"]["evidence"] = ""
        with self.assertRaises(ValueError):
            validate_acceptance(changed, COMMIT)

    def test_only_explicit_non_oracle_checks_can_be_not_applicable(self):
        changed = copy.deepcopy(self.value); changed["oracleApplicable"] = False
        changed["tests"]["T07"]["status"] = changed["tests"]["T26"]["status"] = "N/A"
        validate_acceptance(changed, COMMIT)
        changed["oracleApplicable"] = True
        with self.assertRaises(ValueError):
            validate_acceptance(changed, COMMIT)

    def test_tampered_archive_and_per_file_hash_are_rejected_before_writes(self):
        original_archive = self.archive.read_bytes()
        self.archive.write_bytes(original_archive + b"tamper")
        output = self.root / "verified"
        with self.assertRaises(ValueError):
            verify(self.acceptance, self.archive, COMMIT, output)
        self.assertFalse(output.exists())
        self.archive.write_bytes(original_archive)
        self.value["artifactSha256"] = sha(original_archive)
        self.value["files"]["index.html"]["sha256"] = "0" * 64; self.save()
        with self.assertRaises(ValueError):
            verify(self.acceptance, self.archive, COMMIT, output)
        self.assertFalse(output.exists())

    def test_links_traversal_duplicate_and_oversized_members_are_rejected(self):
        for name, kind, size in [("../outside", tarfile.REGTYPE, 0), ("index.html", tarfile.SYMTYPE, 0), ("index.html", tarfile.LNKTYPE, 0), ("index.html", tarfile.REGTYPE, 6 * 1024 * 1024)]:
            with self.subTest(name=name, kind=kind, size=size):
                member = tarfile.TarInfo(name); member.type = kind; member.linkname = "../outside"; member.size = size
                self.rewrite_archive([(member, b"x" * size)])
                with self.assertRaises(ValueError):
                    verify(self.acceptance, self.archive, COMMIT, self.root / "verified")
                self.assertFalse((self.root / "verified").exists())
                self.assertFalse((self.root / "outside").exists())
        member = tarfile.TarInfo("index.html"); member.size = len(self.bodies["index.html"])
        self.rewrite_archive([(member, self.bodies["index.html"])] * 2)
        with self.assertRaises(ValueError):
            verify(self.acceptance, self.archive, COMMIT, self.root / "verified")

    def test_extra_private_files_secrets_missing_files_and_duplicate_manifest_keys(self):
        changed = copy.deepcopy(self.value); changed["files"]["private/key.txt"] = {"sha256": "0" * 64, "bytes": 0}
        with self.assertRaises(ValueError):
            validate_acceptance(changed, COMMIT)
        self.acceptance.write_text('{"format":"library-candidate-1","format":"duplicate"}')
        with self.assertRaises(ValueError):
            verify(self.acceptance, self.archive, COMMIT, self.root / "verified")
        (self.source / "assets/synthetic.js").write_bytes(b"SECRET-CANARY")
        with self.assertRaises(ValueError):
            pack(self.source, self.root / "unsafe.tar.gz", self.root / "unsafe.json", COMMIT, "0.16.0")

    def test_nonzero_trailer_and_comment_only_csp_are_not_accepted(self):
        self.archive.write_bytes(gzip.compress(gzip.decompress(self.archive.read_bytes()) + b"hidden trailer"))
        self.value["artifactSha256"] = sha(self.archive.read_bytes()); self.save()
        with self.assertRaisesRegex(ValueError, "trailer"):
            verify(self.acceptance, self.archive, COMMIT, self.root / "verified")
        self.bodies["index.html"] = b"<!-- Content-Security-Policy script-src 'self'; -->"
        self.value["files"]["index.html"] = {"bytes": len(self.bodies["index.html"]), "sha256": sha(self.bodies["index.html"])}
        members = []
        for name, body in self.bodies.items():
            member = tarfile.TarInfo(name); member.size = len(body); members.append((member,body))
        self.rewrite_archive(members)
        with self.assertRaisesRegex(ValueError, "CSP"):
            verify(self.acceptance, self.archive, COMMIT, self.root / "verified")


if __name__ == "__main__":
    unittest.main()
