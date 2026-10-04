#!/usr/bin/env python3
"""Validate specification-package consistency; NOT application/engine acceptance.

Python 3.10+; standard library only. Run from any directory:
  python tools/verify-package.py [--report path/to/package-check.json]
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
import sys
import zipfile
from collections import Counter
from pathlib import Path
from urllib.parse import unquote
from uuid import UUID

ROOT = Path(__file__).resolve().parents[1]
CHECKS: list[str] = []
# Installed dependencies/build outputs are not part of the authored specification package.
GENERATED = {"node_modules", "dist", ".git", "playwright-report", "test-results"}


def package_files(pattern: str):
    return (p for p in ROOT.rglob(pattern)
            if not any(part in GENERATED for part in p.relative_to(ROOT).parts)
            and p.relative_to(ROOT).parts[:2] != ("public", "vendor"))


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def load(path: str) -> dict | list:
    return json.loads((ROOT / path).read_text(encoding="utf-8"))


def record(message: str) -> None:
    CHECKS.append(message)
    print(f"PASS: {message}")


def check_documents() -> tuple[int, int]:
    spec = (ROOT / "SPEC.md").read_text(encoding="utf-8")
    req = re.findall(r"\*\*(REQ-\d{3})\s*[—–-]", spec)
    expected = {f"REQ-{i:03d}" for i in range(1, 81)}
    require(len(req) == 80 and set(req) == expected, "Requirement definitions differ from REQ-001..080")
    cases = load("fixtures/acceptance-index.json")
    require(isinstance(cases, list), "Acceptance index must be an array")
    ids = [c["id"] for c in cases]
    require(len(ids) == 72 and set(ids) == {f"AT-{i:03d}" for i in range(1, 73)}, "AT IDs are not unique/complete")
    coverage = {r for c in cases for r in c["requirements"]}
    require(coverage == expected, f"Invalid/incomplete requirement coverage: {coverage ^ expected}")
    tests_md = (ROOT / "ACCEPTANCE_TESTS.md").read_text(encoding="utf-8")
    headings = re.findall(r"^###\s+(AT-\d{3})\b", tests_md, re.M)
    require(set(headings) == set(ids) and len(headings) == len(ids), "Markdown AT headings differ from index")
    for case in cases:
        require(all(phase in {f"P{i}" for i in range(9)} for phase in case["phase"].split("/")), f"Unknown phase: {case['id']}")
        for field in ["title", "given", "when", "then", "level"]:
            require(bool(case[field]), f"Missing {field}: {case['id']}")
    for doc in package_files("*.md"):
        content = doc.read_text(encoding="utf-8")
        for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", content):
            if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
                continue
            path = unquote(target.split("#", 1)[0])
            require((doc.parent / path).exists(), f"Broken local link in {doc.name}: {target}")
    record("80 requirements, 72 acceptance scenarios, complete coverage and local Markdown links")
    return len(req), len(cases)


def check_workspace(doc: dict) -> None:
    require(doc["formatVersion"] == 1, "Unexpected workspace format")
    require(isinstance(doc["revision"], int) and doc["revision"] >= 0, "Invalid revision")
    wid = doc["workspace"]["id"]
    UUID(wid)
    maps = ["datasets", "datasetVersions", "analyses", "runs", "results", "visualizations", "artifacts"]
    internal_ids = []
    for name in maps:
        for key, item in doc[name].items():
            UUID(key)
            require(key == item["id"], f"ID mismatch in {name}")
            require(item["workspaceId"] == wid, f"Wrong workspace in {name}")
            internal_ids.append(key)
    require(len(internal_ids) == len(set(internal_ids)), "Cross-kind ID collision")
    names = []
    for dataset in doc["datasets"].values():
        name = dataset["sqlName"]
        require(bool(re.fullmatch(r"[a-z_][a-z0-9_]{0,62}", name)) and not name.startswith("__dw_"), "Invalid SQL alias")
        names.append(name)
        v = doc["datasetVersions"][dataset["currentVersionId"]]
        require(v["datasetId"] == dataset["id"], "Wrong current version owner")
    require(len(names) == len(set(names)), "Duplicate aliases")
    for version in doc["datasetVersions"].values():
        require(version["datasetId"] in doc["datasets"], "Missing version owner")
        backing = version["backing"]
        if backing["kind"] == "artifact":
            require(backing["artifactId"] in doc["artifacts"], "Missing version artifact")
        cols = [c["name"] for c in version["schema"]["columns"]]
        require(len(cols) == len(set(cols)), "Duplicate column names")
    for analysis in doc["analyses"].values():
        require(analysis["revision"] >= 1, "Invalid analysis revision")
        require((analysis["kind"], analysis["engineId"]) in [("sql", "duckdb-local"), ("r", "webr-local")], "Wrong analysis engine")
        for binding in analysis["inputs"]:
            src = binding["source"]
            if src["kind"] == "dataset":
                require(src["datasetId"] in doc["datasets"], "Missing analysis input")
                if "versionId" in src:
                    require(doc["datasetVersions"][src["versionId"]]["datasetId"] == src["datasetId"], "Input version owner mismatch")
            else:
                require(src["resultId"] in doc["results"], "Missing result input")
    for result in doc["results"].values():
        require(result["runId"] in doc["runs"], "Missing result run")
    for run in doc["runs"].values():
        for result_id in run["resultIds"]:
            require(doc["results"][result_id]["runId"] == run["id"], "Wrong result backref")
    for viz in doc["visualizations"].values():
        require(doc["results"][viz["tableResultId"]]["kind"] == "table", "Visualization without table")


def check_examples() -> None:
    files = list(package_files("*.json"))
    for path in files:
        json.loads(path.read_text(encoding="utf-8"))
    for name in ["workspace.empty.json", "workspace.recipe.json"]:
        check_workspace(load(f"fixtures/{name}"))
    manifest = load("fixtures/sample.manifest.json")
    require(manifest["archiveFormat"] == "datenwerkstatt" and manifest["archiveVersion"] == 1, "Wrong archive header")
    require(manifest["mode"] == "recipe" and not manifest["files"], "Fixture is a no-data recipe")
    check_workspace(manifest["project"])
    require(manifest["project"] == load("fixtures/workspace.recipe.json"), "Recipe/manifest divergence")
    with zipfile.ZipFile(ROOT / "fixtures/sample.dwproj") as z:
        require(z.namelist() == ["manifest.json"], "Unexpected sample archive entries")
        require(z.testzip() is None, "Corrupt sample ZIP")
        require(json.loads(z.read("manifest.json")) == manifest, "ZIP/manifest divergence")
    for path in (ROOT / "contracts").glob("*.ts"):
        for module in re.findall(r"from ['\"](\.[^'\"]+)['\"]", path.read_text(encoding="utf-8")):
            require((path.parent / (module + ".ts")).exists(), f"Unresolved own TypeScript import: {module}")
    runtime = load("fixtures/runtime-config.dev.example.json")
    ts = (ROOT / "contracts/runtime-config.ts").read_text(encoding="utf-8").split("export const V1_LIMITS", 1)[1]
    limits = {key: int(value.replace("_", "")) for key, value in re.findall(r"\b(\w+):\s*([\d_]+),", ts)}
    require(runtime["limits"] == limits, "Runtime default limits diverge")
    context = load("fixtures/explore-context.v4.example.json")
    require(context["version"] == 4 and context["datasetId"] == "demo.bevoelkerung", "Wrong portal fixture")
    issue = load("fixtures/explore-context.issue-current.example.json")
    require(issue["datasetId"] == "demo.issue-2024", "Issue pin fixture mismatch")
    record(f"JSON examples, workspace references, recipe archive, contract imports and runtime limits ({len(files)} JSON files)")


def check_fixture_math() -> None:
    con = sqlite3.connect(":memory:")
    con.row_factory = sqlite3.Row
    con.execute("ATTACH DATABASE ':memory:' AS data")
    schemas = load("fixtures/schemas.json")
    for table, schema in schemas.items():
        columns = schema["columns"]
        definitions = ", ".join(f'"{c["name"]}" {"INTEGER" if c["logicalType"] == "INTEGER" else "TEXT"}' for c in columns)
        con.execute(f'CREATE TABLE data."{table}" ({definitions})')
        with (ROOT / f"fixtures/{table}.csv").open(encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f, delimiter=";")
            require(reader.fieldnames == [c["name"] for c in columns], f"Header mismatch {table}")
            rows = []
            for row in reader:
                values = [int(row[c["name"]]) if c["logicalType"] == "INTEGER" else row[c["name"]] for c in columns]
                require(bool(re.fullmatch(r"00[1-4]", row["gemeinde_id"])), "Identifier lost leading zeros")
                rows.append(values)
            placeholders = ",".join("?" for _ in columns)
            con.executemany(f'INSERT INTO data."{table}" VALUES ({placeholders})', rows)
    sql = (ROOT / "fixtures/01-fahrzeuge-pro-1000.sql").read_text(encoding="utf-8")
    actual = [dict(row) for row in con.execute(sql, {"jahr": 2024})]
    expected = load("fixtures/golden/sql-2024.json")
    require(actual == expected["rows"] and str(len(actual)) == expected["rowCount"], "Reference SQL differs from golden")
    r_expected = load("fixtures/golden/r-vergleich.json")
    classified = []
    for row in actual:
        val = row["fahrzeuge_pro_1000"]
        classified.append({**row, "klasse": "nicht berechenbar" if val is None else "hoch" if val >= 600 else "niedrig"})
    require(classified == r_expected["rows"], "Python reference classification differs from golden R values")
    counts = Counter(r["klasse"] for r in classified)
    back = [{"klasse": k, "anzahl": str(v)} for k, v in sorted(counts.items())]
    require(back == load("fixtures/golden/rueck-sql.json")["rows"], "Back-SQL golden counts differ")
    con.execute("CREATE TABLE data.vergleich(klasse TEXT)")
    con.executemany("INSERT INTO data.vergleich VALUES (?)", [(r["klasse"],) for r in classified])
    back_sql = (ROOT / "fixtures/03-klassifikation.sql").read_text(encoding="utf-8")
    sqlite_back = [{"klasse": row["klasse"], "anzahl": str(row["anzahl"])} for row in con.execute(back_sql)]
    require(sqlite_back == back, "Reference return query differs")
    con.close()
    record("Synthetic SQL/reference classification/return-SQL golden values (SQLite/Python, NOT DuckDB or R)")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, help="Write package-check JSON report")
    args = parser.parse_args()
    try:
        requirements, cases = check_documents()
        check_examples()
        check_fixture_math()
        forbidden = [p for p in package_files("*") if p.suffix.lower() in {".ttf", ".otf", ".woff", ".woff2"}]
        require(not forbidden, "Font files must not be distributed")
        record("No font files bundled")
    except (ValueError, KeyError, TypeError, OSError, sqlite3.Error, zipfile.BadZipFile) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1
    report = {
        "specVersion": "1.0.0", "status": "passed", "requirements": requirements,
        "acceptanceScenarios": cases, "checks": CHECKS,
        "pythonVersion": sys.version.split()[0], "sqliteVersion": sqlite3.sqlite_version,
        "notExecuted": ["application-build", "DuckDB-WASM", "R-webR", "browser", "container", "performance"],
    }
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Package checks passed; application acceptance is reported separately in docs/IMPLEMENTATION_STATUS.md.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
