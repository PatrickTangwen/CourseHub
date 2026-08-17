#!/usr/bin/env python
"""CourseHub 离线预处理：15 个学期快照 → Course Index / Knowledge Docs / 词典。

用法：
    python tools/build_course_data.py \
        [--snapshots-dir <catalogs/public 目录>] \
        [--out-dir <输出目录，默认后端目录下的 data/coursehub>]

产物（派生数据，快照更新时整体重建，不进 git）：
    course_index.sqlite   结构化 Course Index（精确数字的唯一来源，ADR-0001）
    knowledge_docs.json   每门唯一课程一篇的 Knowledge Doc（灌入向量知识库）
    dictionaries.json     {"subjects": [...], "instructors": [...]} 实体词典

纯 stdlib，可在无后端依赖的系统 Python 上运行。
"""
import argparse
import pathlib
import sys

_COURSEHUB_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_COURSEHUB_ROOT) not in sys.path:
    sys.path.insert(0, str(_COURSEHUB_ROOT))

from coursedata.bootstrap import ensure_course_data_artifacts  # noqa: E402

DEFAULT_SNAPSHOTS_DIR = (
    _COURSEHUB_ROOT.parent
    / "ucsd-course-data" / "01-current-published-data"
    / "api" / "static" / "catalogs" / "public"
)
DEFAULT_OUT_DIR = _COURSEHUB_ROOT / "data" / "coursehub"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--snapshots-dir", type=pathlib.Path, default=DEFAULT_SNAPSHOTS_DIR,
                        help=f"学期快照目录（默认: {DEFAULT_SNAPSHOTS_DIR}）")
    parser.add_argument("--out-dir", type=pathlib.Path, default=DEFAULT_OUT_DIR,
                        help=f"输出目录（默认: {DEFAULT_OUT_DIR}）")
    args = parser.parse_args()

    print(f"快照目录: {args.snapshots_dir}")
    print(f"输出目录: {args.out_dir}")
    try:
        result = ensure_course_data_artifacts(args.snapshots_dir, args.out_dir, force=True)
    except FileNotFoundError as ex:
        print(f"错误: {ex}", file=sys.stderr)
        return 1

    print(f"snapshots:           {result['snapshots']}")
    print(f"terms:               {result['terms']}")
    print(f"courses (term-course): {result['courses']}")
    print(f"unique courses/docs: {result['documents']}")
    print(f"sections:            {result['sections']}")
    print(f"grade records:       {result['grade_records']}")
    print(f"instructors:         {result['instructors']}")
    print(f"subjects:            {result['subjects']}")
    print(f"完成: {result['index_path']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
