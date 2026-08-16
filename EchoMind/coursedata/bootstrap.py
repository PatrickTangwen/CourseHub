"""Build and validate the derived CourseHub data artifacts used at runtime."""

import json
import os
import pathlib
import sqlite3
import tempfile
from typing import Any, Dict, Union

from coursedata.build import (
    COURSE_INDEX_SCHEMA_VERSION,
    build_dictionaries,
    build_index,
    render_knowledge_docs,
)

PathLike = Union[str, pathlib.Path]
INDEX_NAME = "course_index.sqlite"
DOCS_NAME = "knowledge_docs.json"
DICTIONARIES_NAME = "dictionaries.json"


def _schema_version(path: pathlib.Path) -> int:
    conn = None
    try:
        conn = sqlite3.connect(str(path))
        return int(conn.execute("PRAGMA user_version").fetchone()[0])
    except (OSError, sqlite3.Error, TypeError, ValueError):
        return -1
    finally:
        if conn is not None:
            conn.close()


def _json_is_valid(path: pathlib.Path, expected_type: type) -> bool:
    try:
        return isinstance(json.loads(path.read_text(encoding="utf-8")), expected_type)
    except (OSError, UnicodeError, json.JSONDecodeError):
        return False


def _artifacts_are_current(snapshot_paths, out_dir: pathlib.Path) -> bool:
    index_path = out_dir / INDEX_NAME
    docs_path = out_dir / DOCS_NAME
    dictionaries_path = out_dir / DICTIONARIES_NAME
    if not all(path.is_file() for path in (index_path, docs_path, dictionaries_path)):
        return False
    if _schema_version(index_path) != COURSE_INDEX_SCHEMA_VERSION:
        return False
    if not _json_is_valid(docs_path, list) or not _json_is_valid(dictionaries_path, dict):
        return False

    newest_snapshot = max(path.stat().st_mtime_ns for path in snapshot_paths)
    return min(
        index_path.stat().st_mtime_ns,
        docs_path.stat().st_mtime_ns,
        dictionaries_path.stat().st_mtime_ns,
    ) >= newest_snapshot


def ensure_course_data_artifacts(
    snapshots_dir: PathLike,
    out_dir: PathLike,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    """Ensure the complete runtime data set exists and matches the current schema.

    The three artifacts are first rendered in a temporary sibling directory, then
    individually replaced, so a failed build never leaves partially written files.
    """
    snapshots_dir = pathlib.Path(snapshots_dir)
    out_dir = pathlib.Path(out_dir)
    snapshot_paths = sorted(snapshots_dir.glob("*.json"))
    if not snapshot_paths:
        raise FileNotFoundError(f"{snapshots_dir} 下没有课程快照 JSON")

    out_dir.mkdir(parents=True, exist_ok=True)
    if not force and _artifacts_are_current(snapshot_paths, out_dir):
        return {
            "rebuilt": False,
            "snapshots": len(snapshot_paths),
            "index_path": str(out_dir / INDEX_NAME),
            "docs_path": str(out_dir / DOCS_NAME),
            "dictionaries_path": str(out_dir / DICTIONARIES_NAME),
        }

    with tempfile.TemporaryDirectory(prefix="coursehub-build-", dir=out_dir) as temp_name:
        temp_dir = pathlib.Path(temp_name)
        index_path = temp_dir / INDEX_NAME
        docs_path = temp_dir / DOCS_NAME
        dictionaries_path = temp_dir / DICTIONARIES_NAME

        counts = build_index(snapshot_paths, index_path)
        docs = render_knowledge_docs(snapshot_paths)
        dictionaries = build_dictionaries(snapshot_paths)
        docs_path.write_text(json.dumps(docs, ensure_ascii=False, indent=1), encoding="utf-8")
        dictionaries_path.write_text(
            json.dumps(dictionaries, ensure_ascii=False, indent=1),
            encoding="utf-8",
        )

        for source in (index_path, docs_path, dictionaries_path):
            os.replace(source, out_dir / source.name)

    return {
        "rebuilt": True,
        "snapshots": len(snapshot_paths),
        "documents": len(docs),
        "instructors": len(dictionaries["instructors"]),
        "subjects": len(dictionaries["subjects"]),
        **counts,
        "index_path": str(out_dir / INDEX_NAME),
        "docs_path": str(out_dir / DOCS_NAME),
        "dictionaries_path": str(out_dir / DICTIONARIES_NAME),
    }
