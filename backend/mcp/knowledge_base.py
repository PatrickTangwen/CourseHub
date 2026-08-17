"""
RAG 知识库 —— 基于 ChromaDB 的真实检索实现。

功能：
  1. 文档导入：将文本切片后存入 ChromaDB（自动生成 Embedding）
  2. 语义检索：根据 query 从知识库中检索最相关的文档片段
  3. 与 MCP 工具框架集成：作为 knowledge_search 工具的真实 handler

ChromaDB 在这里的角色：
  - memory/ 中用于存储对话记忆（情景记忆 + 用户画像）
  - 这里用于存储知识库文档（RAG 检索）
  两者是不同的 collection，互不干扰。
"""
import asyncio
import hashlib
import json
import logging
import pathlib
import re
from typing import Any, Dict, List, Optional, Union

import chromadb

logger = logging.getLogger(__name__)


class KnowledgeBase:
    """
    基于 ChromaDB 的 RAG 知识库。

    ChromaDB 内置了 Embedding 模型（all-MiniLM-L6-v2），
    调用 add() 时自动生成向量，query() 时自动做语义匹配。
    不需要额外调用 Anthropic Embeddings API。
    """

    COLLECTION_NAME = "knowledge_base"

    def __init__(
        self,
        chroma_host: str = "localhost",
        chroma_port: int = 8000,
        chroma_path: str = "./data/chroma",
    ):
        # 优先连接独立 ChromaDB 服务（服务端内置 embedding 模型，客户端无需下载）
        self._use_server = False
        try:
            # HttpClient 默认也会初始化 ChromaDB telemetry；显式关闭避免 posthog 兼容性错误日志。
            self._client = chromadb.HttpClient(
                host=chroma_host,
                port=chroma_port,
                settings=chromadb.Settings(anonymized_telemetry=False),
            )
            self._client.heartbeat()
            self._use_server = True
            logger.info(f"知识库 ChromaDB 已连接: {chroma_host}:{chroma_port}")
        except Exception:
            logger.info(f"知识库 ChromaDB 服务不可用，使用本地模式: {chroma_path}")
            self._client = chromadb.PersistentClient(
                path=chroma_path,
                settings=chromadb.Settings(anonymized_telemetry=False),
            )

        # 使用服务端时不传 embedding_function，让服务端处理
        # 本地模式时也不传，使用 ChromaDB 默认的（会触发模型下载）
        self._collection = self._client.get_or_create_collection(
            name=self.COLLECTION_NAME,
            metadata={"description": "CourseHub RAG 知识库"},
        )

        # 如果知识库为空，导入默认文档
        if self._collection.count() == 0:
            self._load_default_docs()
        else:
            self._warn_if_stale_theme()

    # ── 文档管理 ──────────────────────────────────────────────────────────────

    def add_documents(
        self,
        documents: List[Dict[str, Any]],
        *,
        dataset: str = "user",
    ) -> int:
        """
        批量导入文档到知识库。

        documents 格式: [{"title": "...", "content": "...", "metadata": {...}}, ...]
        metadata 可选，键值会并入每个片段的 ChromaDB metadata（值需为标量），
        用于按学期/科目等维度过滤和排查。长文档会自动切片（每片 500 字）。
        """
        ids, docs, metas = [], [], []

        for doc in documents:
            title   = doc.get("title", "")
            content = doc.get("content", "")
            extra   = doc.get("metadata") or {}
            chunks  = self._chunk_text(content, chunk_size=500)
            document_id = str(extra.get("document_id") or hashlib.sha256(
                f"{dataset}\0{title}\0{content}".encode("utf-8")
            ).hexdigest())

            for i, chunk in enumerate(chunks):
                doc_id = hashlib.sha256(f"{dataset}\0{document_id}\0{i}".encode("utf-8")).hexdigest()
                ids.append(doc_id)
                docs.append(chunk)
                meta = {
                    "title": title,
                    "chunk_index": i,
                    "total_chunks": len(chunks),
                    "dataset": dataset,
                    "document_id": document_id,
                }
                meta.update({
                    k: v for k, v in extra.items()
                    if isinstance(v, (str, int, float, bool))
                })
                metas.append(meta)

        if ids:
            # ChromaDB 会自动生成 Embedding。固定小批量避免超过不同后端的
            # max_batch_size（完整课程库约 8k 片段）。
            batch_size = 500
            for start in range(0, len(ids), batch_size):
                end = start + batch_size
                self._collection.upsert(
                    ids=ids[start:end],
                    documents=docs[start:end],
                    metadatas=metas[start:end],
                )
            logger.info(f"知识库导入 {len(ids)} 个文档片段")

        return len(ids)

    async def add_documents_async(self, documents: List[Dict[str, str]]) -> int:
        """异步导入文档；ChromaDB 客户端为同步实现，因此放入线程池执行。"""
        return await asyncio.to_thread(self.add_documents, documents)

    def ensure_course_documents(
        self,
        docs_path: Union[str, pathlib.Path],
        *,
        force: bool = False,
    ) -> int:
        """Idempotently load the generated catalog documents into ChromaDB."""
        docs_path = pathlib.Path(docs_path)
        documents = json.loads(docs_path.read_text(encoding="utf-8"))
        if not isinstance(documents, list) or not documents:
            raise ValueError(f"课程知识文档为空或格式错误: {docs_path}")

        prepared = []
        expected_keys = set()
        for doc in documents:
            metadata = dict(doc.get("metadata") or {})
            subject = str(metadata.get("subject", "")).upper()
            course_number = str(metadata.get("course_number", "")).upper()
            if not subject or not course_number:
                raise ValueError(f"课程知识文档缺少 subject/course_number: {doc.get('title', '')}")
            document_id = f"course:{subject}:{course_number}"
            metadata["document_id"] = document_id
            expected_keys.add(document_id)
            prepared.append({**doc, "metadata": metadata})

        current = self._collection.get(include=["metadatas"])
        current_ids = current.get("ids") or []
        current_metas = current.get("metadatas") or []
        catalog_keys = {
            meta.get("document_id")
            for meta in current_metas
            if meta and meta.get("dataset") == "coursehub_catalog"
        }
        if not force and catalog_keys == expected_keys:
            return 0

        stale_ids = [
            item_id
            for item_id, meta in zip(current_ids, current_metas)
            if meta and (
                meta.get("dataset") == "coursehub_catalog"
                or (
                    not meta.get("dataset")
                    and meta.get("subject")
                    and meta.get("course_number")
                )
            )
        ]
        if stale_ids:
            self._collection.delete(ids=stale_ids)
        return self.add_documents(prepared, dataset="coursehub_catalog")

    async def ensure_course_documents_async(
        self,
        docs_path: Union[str, pathlib.Path],
        *,
        force: bool = False,
    ) -> int:
        """Async wrapper for startup course-document loading."""
        return await asyncio.to_thread(self.ensure_course_documents, docs_path, force=force)

    def stats(self) -> Dict[str, int]:
        """Return chunk, logical-document, and catalog-document counts."""
        result = self._collection.get(include=["metadatas"])
        metadatas = [meta or {} for meta in result.get("metadatas") or []]
        document_ids = {
            str(meta.get("document_id") or meta.get("title") or f"chunk:{index}")
            for index, meta in enumerate(metadatas)
        }
        course_documents = {
            str(meta.get("document_id"))
            for meta in metadatas
            if meta.get("dataset") == "coursehub_catalog" and meta.get("document_id")
        }
        return {
            "total_chunks": self._collection.count(),
            "total_documents": len(document_ids),
            "course_documents": len(course_documents),
        }

    async def stats_async(self) -> Dict[str, int]:
        """Async wrapper for knowledge-base statistics."""
        return await asyncio.to_thread(self.stats)

    def has_course_documents(self) -> bool:
        """Check catalog readiness without transferring the collection metadata."""
        result = self._collection.get(
            where={"dataset": "coursehub_catalog"},
            limit=1,
            include=[],
        )
        return bool(result.get("ids"))

    async def has_course_documents_async(self) -> bool:
        """Async wrapper for the lightweight catalog readiness check."""
        return await asyncio.to_thread(self.has_course_documents)

    def search(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """
        语义检索：根据 query 返回最相关的文档片段。

        ChromaDB 内部自动将 query 转为向量，与存储的文档向量做余弦相似度匹配。
        """
        results = self._collection.query(
            query_texts=[query],
            n_results=top_k,
        )

        items = []
        if results["documents"] and results["documents"][0]:
            for doc, meta, dist in zip(
                results["documents"][0],
                results["metadatas"][0],
                results["distances"][0],
            ):
                items.append({
                    "title":    meta.get("title", ""),
                    "content":  doc,
                    "score":    round(1.0 - dist, 4),  # ChromaDB 返回距离，转为相似度
                    "chunk":    meta.get("chunk_index", 0),
                })

        return items

    async def search_async(self, query: str, top_k: int = 5) -> List[Dict[str, Any]]:
        """异步检索；ChromaDB 客户端为同步实现，因此放入线程池执行。"""
        return await asyncio.to_thread(self.search, query, top_k)

    @property
    def doc_count(self) -> int:
        return self._collection.count()

    async def doc_count_async(self) -> int:
        """异步获取文档片段数量。"""
        return await asyncio.to_thread(self._collection.count)

    # ── MCP 工具 handler ─────────────────────────────────────────────────────

    async def search_handler(self, params: Dict[str, Any], context: Any) -> List[Dict]:
        """
        作为 MCP 工具的 handler 注册。

        MCPToolManager.register(Tool(
            name="knowledge_search",
            handler=kb.search_handler,
            ...
        ))
        """
        query = params.get("query", "")
        top_k = params.get("top_k", 5)
        return await self.search_async(query, top_k=top_k)

    # ── 内部方法 ──────────────────────────────────────────────────────────────

    def _chunk_text(self, text: str, chunk_size: int = 500) -> List[str]:
        """将长文本按 chunk_size 切片，保留语义完整性。

        先按换行切段（Knowledge Doc 渲染器以短行为契约），超长段落再按
        中/英文句号切句；单句仍超长时按字符硬切，保证没有超限 chunk。
        """
        if len(text) <= chunk_size:
            return [text] if text.strip() else []

        segments: List[str] = []
        for line in text.split("\n"):
            line = line.strip()
            if not line:
                continue
            if len(line) <= chunk_size:
                segments.append(line)
                continue
            # 超长行：按句子切（中文句号或英文句号+空格），仍超长则硬切
            for sent in re.split(r"(?<=。)|(?<=\.)\s+", line):
                sent = sent.strip()
                if not sent:
                    continue
                while len(sent) > chunk_size:
                    segments.append(sent[:chunk_size])
                    sent = sent[chunk_size:]
                if sent:
                    segments.append(sent)

        chunks: List[str] = []
        current = ""
        for seg in segments:
            if len(current) + len(seg) + 1 > chunk_size:
                if current:
                    chunks.append(current)
                current = seg
            else:
                current = f"{current}\n{seg}" if current else seg
        if current:
            chunks.append(current)
        return chunks

    def _warn_if_stale_theme(self) -> None:
        """非空库启动时检查是否还是旧客服主题的数据（就地升级场景）。

        collection 名称未变，旧部署的向量数据会原样保留；这里不自动删除
        用户数据，只在检测到旧主题文档时给出明确的重建指引。
        """
        try:
            probe = self._collection.get(limit=50, include=["metadatas"])
            titles = {m.get("title", "") for m in probe.get("metadatas") or [] if m}
        except Exception:
            return
        stale_titles = {"退款政策", "订单查询", "账户安全", "技术故障排查", "会员与积分", "配送说明"}
        if titles & stale_titles:
            logger.warning(
                "知识库中检测到旧客服主题文档（如 退款政策）。建议清空 collection 后"
                "重新导入课程数据：删除 ChromaDB volume 或用 Python 客户端 "
                "delete_collection('knowledge_base')，重启后运行 tools/ingest_knowledge_docs.py"
            )

    def _load_default_docs(self) -> None:
        """导入默认知识库文档（CourseHub 元信息）。

        课程正文数据由 tools/build_course_data.py 渲染后批量导入；这里只放
        描述系统自身的元文档，保证空库启动时 meta 类问题有据可答。
        """
        default_docs = [
            {
                "title": "CourseHub 数据来源与覆盖",
                "content": (
                    "CourseHub 的数据来自 UCSD 课程目录快照（SunGrid 发布）。"
                    "覆盖 FA24 至 FA26 共 15 个学期，包括秋冬春三个常规学季和夏季学期。"
                    "数据为静态快照，生成时间为 2026-08-13；不是实时数据。"
                    "包含：课程内容与学分、先修与限制、上课时间地点、名额快照、授课教授、成绩历史记录。"
                ),
            },
            {
                "title": "名额数据使用规则",
                "content": (
                    "名额、座位、waitlist 数字来自课程目录快照，附有快照时间戳。"
                    "这些数字不是实时的，实际选课名额以 WebReg 为准。"
                    "最新学期的名额覆盖完整；较早学期的名额覆盖不完整，缺失时会如实说明。"
                ),
            },
            {
                "title": "成绩历史数据的读法",
                "content": (
                    "成绩参考来自 Instructor Grade Archive，按教授和学期逐条记录 GPA 与成绩分布。"
                    "不同教授、不同学期的差异很大，因此不提供也不应合成单一的课程平均 GPA。"
                    "CourseHub 没有 CAPE 或 SET 教评数据。"
                    "成绩记录只覆盖部分课程和学期；没有记录不代表课程有问题。"
                ),
            },
            {
                "title": "CourseHub 能力边界",
                "content": (
                    "CourseHub 可以回答：课程内容、学分、先修、上课时间地点、名额快照、授课教授、成绩历史，"
                    "并提供非官方的选课规划参考。"
                    "CourseHub 不能：代用户注册或退课、提供实时名额、提供 CAPE/SET 教评、出具官方 advising 结论。"
                    "个案事务（enrollment hold、petition、prereq waiver、成绩申诉）需要通过官方渠道处理："
                    "Virtual Advising Center、院系 advisor 或 WebReg 支持。"
                ),
            },
            {
                "title": "UCSD 学期代码说明",
                "content": (
                    "UCSD 学期代码：FA 表示秋季（Fall），WI 表示冬季（Winter），SP 表示春季（Spring），"
                    "S1/S2/S3 表示夏季学期（Summer Session）。代码后两位是年份，例如 FA26 是 2026 年秋季。"
                    "问课程信息时建议带上学期，例如 FA26 的 CSE 100；不指定学期时默认按最新学期回答。"
                ),
            },
            {
                "title": "如何问出更准确的答案",
                "content": (
                    "提供课程号（例如 CSE 100、MATH 20C）可以获得精确的课程信息。"
                    "课程号写法宽松：cse100、CSE-100、cse 100 都可以识别。"
                    "学期可以用代码（FA26）或自然语言（Fall 2026、2026 秋）。"
                    "问教授相关信息时给出姓氏即可，例如 Professor Kane。"
                    "中文和英文提问都支持。"
                ),
            },
        ]
        self.add_documents(default_docs, dataset="coursehub_meta")
        logger.info(f"已导入默认知识库: {len(default_docs)} 篇文档")
