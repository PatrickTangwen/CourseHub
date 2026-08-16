"""把 tools/build_course_data.py 渲染的 Knowledge Docs 批量导入知识库。

用法（服务启动后执行）：
    python tools/ingest_knowledge_docs.py [--api http://localhost:8003] [--batch 200]

只依赖标准库；文档带 metadata（subject / course_number / terms_offered）。
"""
import argparse
import json
import pathlib
import sys
import time
import urllib.error
import urllib.request

_ROOT = pathlib.Path(__file__).resolve().parent.parent


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--api", default="http://localhost:8003")
    parser.add_argument("--docs", default=str(_ROOT / "data" / "coursehub" / "knowledge_docs.json"))
    parser.add_argument("--batch", type=int, default=200)
    parser.add_argument("--start", type=int, default=0, help="从第 N 篇文档开始（失败续传）")
    args = parser.parse_args()

    docs = json.loads(pathlib.Path(args.docs).read_text(encoding="utf-8"))
    print(f"待导入文档: {len(docs)}")

    total_chunks = 0
    t0 = time.monotonic()
    for i in range(args.start, len(docs), args.batch):
        batch = docs[i:i + args.batch]
        payload = json.dumps({"documents": batch}).encode("utf-8")
        req = urllib.request.Request(
            f"{args.api}/knowledge/add",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=600) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as ex:
            body = ex.read().decode("utf-8", errors="replace")[:500]
            print(f"批次 {i}-{i + len(batch)} 失败: HTTP {ex.code} {body}", file=sys.stderr)
            print(f"已导入 {total_chunks} 个片段；修复后可用 --start {i} 续传", file=sys.stderr)
            return 1
        added = data.get("added_chunks", 0)
        total_chunks += added if isinstance(added, int) else 0
        done = min(i + args.batch, len(docs))
        print(f"  {done}/{len(docs)} 片段累计 {total_chunks} 用时 {time.monotonic()-t0:.0f}s", flush=True)

    print(f"完成: {len(docs)} 篇文档, {total_chunks} 个片段")
    return 0


if __name__ == "__main__":
    sys.exit(main())
