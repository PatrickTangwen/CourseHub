#!/usr/bin/env python
"""CourseHub 离线预处理：15 个学期快照 → Course Index / Knowledge Docs / 词典。

用法：
    python tools/build_course_data.py \
        [--snapshots-dir <catalogs/public 目录>] \
        [--out-dir <输出目录，默认 EchoMind/data/coursehub>]

产物（派生数据，快照更新时整体重建，不进 git）：
    course_index.sqlite   结构化 Course Index（精确数字的唯一来源，ADR-0001）
    knowledge_docs.json   每门唯一课程一篇的 Knowledge Doc（灌入向量知识库）
    dictionaries.json     {"subjects": [...], "instructors": [...]} 实体词典

纯 stdlib，可在无后端依赖的系统 Python 上运行。
"""
import argparse
import json
import pathlib
import sys

_ECHOMIND_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_ECHOMIND_ROOT) not in sys.path:
    sys.path.insert(0, str(_ECHOMIND_ROOT))

from coursedata.build import build_dictionaries, build_index, render_knowledge_docs  # noqa: E402

DEFAULT_SNAPSHOTS_DIR = (
    _ECHOMIND_ROOT.parent
    / "ucsd-course-data" / "01-current-published-data"
    / "api" / "static" / "catalogs" / "public"
)
DEFAULT_OUT_DIR = _ECHOMIND_ROOT / "data" / "coursehub"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--snapshots-dir", type=pathlib.Path, default=DEFAULT_SNAPSHOTS_DIR,
                        help=f"学期快照目录（默认: {DEFAULT_SNAPSHOTS_DIR}）")
    parser.add_argument("--out-dir", type=pathlib.Path, default=DEFAULT_OUT_DIR,
                        help=f"输出目录（默认: {DEFAULT_OUT_DIR}）")
    args = parser.parse_args()

    snapshot_paths = sorted(args.snapshots_dir.glob("*.json"))
    if not snapshot_paths:
        print(f"错误: {args.snapshots_dir} 下没有找到快照 JSON", file=sys.stderr)
        return 1

    args.out_dir.mkdir(parents=True, exist_ok=True)
    db_path = args.out_dir / "course_index.sqlite"
    docs_path = args.out_dir / "knowledge_docs.json"
    dicts_path = args.out_dir / "dictionaries.json"

    print(f"快照目录: {args.snapshots_dir}  ({len(snapshot_paths)} 个快照)")
    print(f"输出目录: {args.out_dir}")

    counts = build_index(snapshot_paths, db_path)

    docs = render_knowledge_docs(snapshot_paths)
    with open(docs_path, "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=1)

    dicts = build_dictionaries(snapshot_paths)
    with open(dicts_path, "w", encoding="utf-8") as f:
        json.dump(dicts, f, ensure_ascii=False, indent=1)

    print(f"terms:               {counts['terms']}")
    print(f"courses (term-course): {counts['courses']}")
    print(f"unique courses/docs: {len(docs)}")
    print(f"sections:            {counts['sections']}")
    print(f"grade records:       {counts['grade_records']}")
    print(f"instructors:         {len(dicts['instructors'])}")
    print(f"subjects:            {len(dicts['subjects'])}")
    print(f"完成: {db_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
