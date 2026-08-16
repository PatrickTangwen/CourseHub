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
import logging
from typing import Any, Dict, List, Optional

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

    # ── 文档管理 ──────────────────────────────────────────────────────────────

    def add_documents(self, documents: List[Dict[str, Any]]) -> int:
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

            for i, chunk in enumerate(chunks):
                doc_id = hashlib.md5(f"{title}_{i}_{chunk[:50]}".encode()).hexdigest()
                ids.append(doc_id)
                docs.append(chunk)
                meta = {"title": title, "chunk_index": i, "total_chunks": len(chunks)}
                meta.update({
                    k: v for k, v in extra.items()
                    if isinstance(v, (str, int, float, bool))
                })
                metas.append(meta)

        if ids:
            # ChromaDB 会自动生成 Embedding
            self._collection.add(ids=ids, documents=docs, metadatas=metas)
            logger.info(f"知识库导入 {len(ids)} 个文档片段")

        return len(ids)

    async def add_documents_async(self, documents: List[Dict[str, str]]) -> int:
        """异步导入文档；ChromaDB 客户端为同步实现，因此放入线程池执行。"""
        return await asyncio.to_thread(self.add_documents, documents)

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
        """将长文本按 chunk_size 切片，保留语义完整性（按句号/换行切分）。"""
        if len(text) <= chunk_size:
            return [text] if text.strip() else []

        chunks = []
        current = ""
        # 按句子切分
        sentences = text.replace("\n", "。").split("。")
        for sent in sentences:
            sent = sent.strip()
            if not sent:
                continue
            if len(current) + len(sent) + 1 > chunk_size:
                if current:
                    chunks.append(current)
                current = sent
            else:
                current = f"{current}。{sent}" if current else sent

        if current:
            chunks.append(current)

        return chunks

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
        self.add_documents(default_docs)
        logger.info(f"已导入默认知识库: {len(default_docs)} 篇文档")
