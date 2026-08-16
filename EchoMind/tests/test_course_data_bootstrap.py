import json
import pathlib
import sqlite3

from coursedata.bootstrap import ensure_course_data_artifacts


def test_bootstrap_builds_all_artifacts_and_rebuilds_stale_schema(tmp_path):
    snapshots_dir = tmp_path / "snapshots"
    snapshots_dir.mkdir()
    # Use the checked-in miniature snapshots without copying or mutating them.
    fixtures = pathlib.Path(__file__).parent / "fixtures"
    snapshots = [fixtures / "FA26-mini.json", fixtures / "S326-mini.json"]
    for source in snapshots:
        (snapshots_dir / source.name).write_bytes(source.read_bytes())

    out_dir = tmp_path / "artifacts"
    first = ensure_course_data_artifacts(snapshots_dir, out_dir)

    assert first["rebuilt"] is True
    assert first["snapshots"] == 2
    assert (out_dir / "course_index.sqlite").is_file()
    assert (out_dir / "knowledge_docs.json").is_file()
    assert (out_dir / "dictionaries.json").is_file()
    assert len(json.loads((out_dir / "knowledge_docs.json").read_text(encoding="utf-8"))) > 0

    second = ensure_course_data_artifacts(snapshots_dir, out_dir)
    assert second["rebuilt"] is False

    conn = sqlite3.connect(out_dir / "course_index.sqlite")
    try:
        conn.execute("PRAGMA user_version = 1")
        conn.commit()
    finally:
        conn.close()

    repaired = ensure_course_data_artifacts(snapshots_dir, out_dir)
    assert repaired["rebuilt"] is True
    conn = sqlite3.connect(out_dir / "course_index.sqlite")
    try:
        assert conn.execute("PRAGMA user_version").fetchone()[0] == 3
    finally:
        conn.close()
