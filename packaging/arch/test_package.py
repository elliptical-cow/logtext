"""Behavioral tests for the Arch package builder; requires Arch base-devel."""

import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
BUILDER = ROOT / "packaging/arch/build.sh"


class ArchPackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="logtext arch test ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.binaries = self.root / "binary inputs"
        self.binaries.mkdir()
        for name in ("Logtext", "logtext-import-logseq"):
            shutil.copyfile("/usr/bin/true", self.binaries / name)
        self.output = self.root / "package output"

    def build(self, version="1.2.3"):
        return subprocess.run(
            ["bash", str(BUILDER), version, str(self.binaries), str(self.output)],
            text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            env={**os.environ, "LC_ALL": "C"},
        )

    def test_package_metadata_files_modes_and_desktop_entry(self):
        result = self.build()
        self.assertEqual(result.returncode, 0, result.stdout)
        package = self.output / "logtext-1.2.3-1-x86_64.pkg.tar.zst"
        self.assertTrue(package.is_file())
        extracted = self.root / "extracted"
        extracted.mkdir()
        subprocess.run(["bsdtar", "-xf", str(package), "-C", str(extracted)], check=True)
        metadata = (extracted / ".PKGINFO").read_text()
        for entry in (
            "pkgname = logtext", "pkgver = 1.2.3-1", "arch = x86_64",
            "license = AGPL-3.0-only", "depend = gtk3",
            "depend = webkit2gtk-4.1", "depend = xdg-utils",
        ):
            self.assertIn(entry + "\n", metadata)
        self.assertEqual(
            sorted(str(path.relative_to(extracted)) for path in extracted.rglob("*")
                   if path.is_file() and not path.name.startswith(".")),
            ["usr/bin/Logtext", "usr/bin/logtext-import-logseq",
             "usr/share/applications/Logtext.desktop",
             "usr/share/icons/hicolor/256x256/apps/logtext.png",
             "usr/share/licenses/logtext/LICENSE"],
        )
        for name, original in (("Logtext", "Logtext"),
                               ("logtext-import-logseq", "logtext-import-logseq")):
            binary = extracted / "usr/bin" / name
            self.assertEqual(stat.S_IMODE(binary.stat().st_mode), 0o755)
            self.assertEqual(binary.read_bytes(), (self.binaries / original).read_bytes())
        desktop = extracted / "usr/share/applications/Logtext.desktop"
        text = desktop.read_text()
        for entry in ("Name=Logtext", "Exec=Logtext", "Icon=logtext", "Terminal=false"):
            self.assertIn(entry + "\n", text)
        self.assertEqual(stat.S_IMODE(desktop.stat().st_mode), 0o644)
        subprocess.run(["desktop-file-validate", str(desktop)], check=True)
        self.assertEqual(
            (extracted / "usr/share/icons/hicolor/256x256/apps/logtext.png").read_bytes(),
            (ROOT / "src-tauri/icons/128x128@2x.png").read_bytes(),
        )
        self.assertEqual(
            (extracted / "usr/share/licenses/logtext/LICENSE").read_bytes(),
            (ROOT / "LICENSE").read_bytes(),
        )

    def test_missing_binary_fails_without_a_package(self):
        (self.binaries / "logtext-import-logseq").unlink()
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("logtext-import-logseq", result.stdout)
        self.assertFalse(self.output.exists())

    def test_invalid_versions_fail_before_packaging(self):
        for version in ("../1.2.3", "v1.2.3", "1.2.3;touch injected", "1.2"):
            with self.subTest(version=version):
                result = self.build(version)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("version", result.stdout.lower())
                self.assertFalse(self.output.exists())

    def test_non_elf_binary_fails_before_packaging(self):
        (self.binaries / "Logtext").write_text("#!/bin/sh\nexit 0\n")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("x86_64 ELF", result.stdout)
        self.assertFalse(self.output.exists())

    def test_wrong_architecture_fails_before_packaging(self):
        binary = self.binaries / "Logtext"
        data = bytearray(binary.read_bytes())
        data[18:20] = (183).to_bytes(2, "little")  # AArch64 ELF e_machine
        binary.write_bytes(data)
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("x86_64 ELF", result.stdout)
        self.assertFalse(self.output.exists())

    def test_existing_package_is_not_overwritten(self):
        self.output.mkdir()
        package = self.output / "logtext-1.2.3-1-x86_64.pkg.tar.zst"
        package.write_bytes(b"existing package")
        result = self.build()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(package.read_bytes(), b"existing package")


if __name__ == "__main__":
    unittest.main()
