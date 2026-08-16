"""
亮点：端到端意图识别

三路融合策略：
  1. LLM 语义理解（权重 70%）—— 主力，理解复杂语义和上下文
  2. Embedding 向量相似度（权重 20%）—— 快速匹配常见表达
  3. 关键词模式匹配（权重 10%）—— 零延迟兜底

三路结果通过加权投票合并，置信度低于阈值时降级为 OTHER。
LLM 和 Embedding 并行调用，不串行等待。

领域：UCSD 课程问答（CourseHub）。意图分为五个意图组：
  facts（课程事实）/ planning（选课规划）/ general（接待与元信息）/
  escalation（转介官方渠道）/ other。
"""
import asyncio
import hashlib
import json
import logging
import re
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from anthropic import AsyncAnthropic

from core.llm_utils import extract_text_content

logger = logging.getLogger(__name__)

# 相对学期表述（"下学期"）默认解析到当前规划学期。
ACTIVE_PLANNING_TERM = "FA26"


class IntentCategory(Enum):
    # ── 意图组（宽泛类，LLM 不确定细粒度时可直接返回）──
    FACTS      = "facts"       # 课程事实查询
    PLANNING   = "planning"    # 选课规划建议
    GENERAL    = "general"     # 接待/元信息
    ESCALATION = "escalation"  # 转介官方渠道
    # ── facts 组细粒度 ──
    COURSE_OVERVIEW   = "course_overview"    # 课程内容/学分
    PREREQUISITES     = "prerequisites"      # 先修/选课限制
    SCHEDULE          = "schedule"           # 上课时间/地点
    AVAILABILITY      = "availability"       # 名额/waitlist
    INSTRUCTOR_LOOKUP = "instructor_lookup"  # 授课教授
    GRADES_HISTORY    = "grades_history"     # GPA/成绩分布
    COURSE_SEARCH     = "course_search"      # 按条件找课
    # ── planning 组细粒度 ──
    PLAN_SEQUENCE    = "plan_sequence"       # 修课顺序
    WORKLOAD_ADVICE  = "workload_advice"     # 课程组合负担
    PROFESSOR_CHOICE = "professor_choice"    # 选教授/section
    # ── general 组细粒度 ──
    GREETING  = "greeting"                   # 问候
    META_INFO = "meta_info"                  # 数据来源/能力边界
    # ── escalation 组细粒度 ──
    ADVISOR_REFERRAL = "advisor_referral"    # 个案事务转介
    OTHER = "other"


class UrgencyLevel(Enum):
    LOW      = 1
    MEDIUM   = 2
    HIGH     = 3
    CRITICAL = 4


@dataclass
class IntentResult:
    intent:     IntentCategory
    confidence: float
    urgency:    UrgencyLevel
    intent_group: str
    entities:   Dict[str, List[str]]   # 从消息中提取的实体
    reasoning:  str
    latency_ms: float
    source_scores: Dict[str, float] = field(default_factory=dict)


# ── Few-shot 模板（同时用于 LLM 示例和 Embedding 匹配，中英双语）──────────────
_TEMPLATES: Dict[IntentCategory, List[str]] = {
    IntentCategory.FACTS:      ["这门课的信息帮我查一下", "Tell me about this course"],
    IntentCategory.PLANNING:   ["帮我参谋一下选课", "Help me plan my classes"],
    IntentCategory.GENERAL:    ["麻烦帮我看一下", "Can you help me with something?"],
    IntentCategory.ESCALATION: ["这事得找谁办？", "Who do I contact for this?"],
    IntentCategory.COURSE_OVERVIEW: [
        "CSE 100 讲什么？", "What is CSE 100 about?", "MATH 20C 有几个学分？",
    ],
    IntentCategory.PREREQUISITES: [
        "CSE 101 有什么先修要求？", "What are the prerequisites for CSE 101?", "上这门课有什么限制？",
    ],
    IntentCategory.SCHEDULE: [
        "FA26 的 MATH 20C 什么时候上课？", "When does CSE 100 meet?", "这门课在哪个教室上？",
    ],
    IntentCategory.AVAILABILITY: [
        "CSE 100 还有位置吗？", "Is there space left in CSE 100?", "这门课 waitlist 多长？",
    ],
    IntentCategory.INSTRUCTOR_LOOKUP: [
        "谁教 CSE 100？", "Who teaches CSE 100 in FA26?", "这门课的教授是谁？",
    ],
    IntentCategory.GRADES_HISTORY: [
        "CSE 100 历年 GPA 怎么样？", "What's the grade distribution for CSE 100?", "这门课给分好吗？",
    ],
    IntentCategory.COURSE_SEARCH: [
        "FA26 有哪些 4 学分的 CSE 课？", "What CSE courses are offered in FA26?", "帮我找找满足 GE 的课",
    ],
    IntentCategory.PLAN_SEQUENCE: [
        "我该先修 CSE 100 还是 CSE 101？", "Should I take CSE 100 before CSE 101?", "这几门课按什么顺序修？",
    ],
    IntentCategory.WORKLOAD_ADVICE: [
        "同时上 CSE 100 和 CSE 110 会不会太累？", "Is taking CSE 100 and CSE 110 together too much?",
        "这学期排四门专业课负担重吗？",
    ],
    IntentCategory.PROFESSOR_CHOICE: [
        "选 Kane 还是 Sahoo 的 section？", "Which professor should I take for CSE 100?", "哪个教授的 section 更好？",
    ],
    IntentCategory.GREETING: ["你好", "hi", "早上好"],
    IntentCategory.META_INFO: [
        "你的数据是什么时候更新的？", "How fresh is your data?", "你能回答哪些问题？",
    ],
    IntentCategory.ADVISOR_REFERRAL: [
        "我的 enrollment hold 怎么解除？", "How do I get a prereq waiver?", "我要申诉成绩该找谁？",
    ],
}

_SPECIFIC_INTENTS = {
    IntentCategory.COURSE_OVERVIEW,
    IntentCategory.PREREQUISITES,
    IntentCategory.SCHEDULE,
    IntentCategory.AVAILABILITY,
    IntentCategory.INSTRUCTOR_LOOKUP,
    IntentCategory.GRADES_HISTORY,
    IntentCategory.COURSE_SEARCH,
    IntentCategory.PLAN_SEQUENCE,
    IntentCategory.WORKLOAD_ADVICE,
    IntentCategory.PROFESSOR_CHOICE,
    IntentCategory.GREETING,
    IntentCategory.META_INFO,
    IntentCategory.ADVISOR_REFERRAL,
}

_GENERIC_INTENTS = {
    IntentCategory.FACTS,
    IntentCategory.PLANNING,
    IntentCategory.GENERAL,
    IntentCategory.ESCALATION,
}

_INTENT_GROUPS: Dict[IntentCategory, IntentCategory] = {
    IntentCategory.COURSE_OVERVIEW:   IntentCategory.FACTS,
    IntentCategory.PREREQUISITES:     IntentCategory.FACTS,
    IntentCategory.SCHEDULE:          IntentCategory.FACTS,
    IntentCategory.AVAILABILITY:      IntentCategory.FACTS,
    IntentCategory.INSTRUCTOR_LOOKUP: IntentCategory.FACTS,
    IntentCategory.GRADES_HISTORY:    IntentCategory.FACTS,
    IntentCategory.COURSE_SEARCH:     IntentCategory.FACTS,
    IntentCategory.PLAN_SEQUENCE:     IntentCategory.PLANNING,
    IntentCategory.WORKLOAD_ADVICE:   IntentCategory.PLANNING,
    IntentCategory.PROFESSOR_CHOICE:  IntentCategory.PLANNING,
    IntentCategory.GREETING:          IntentCategory.GENERAL,
    IntentCategory.META_INFO:         IntentCategory.GENERAL,
    IntentCategory.ADVISOR_REFERRAL:  IntentCategory.ESCALATION,
}

# 紧急关键词（课程场景：deadline 驱动）
_URGENCY_KEYWORDS = {
    UrgencyLevel.CRITICAL: ["紧急", "emergency", "urgent"],
    UrgencyLevel.HIGH:     ["今天截止", "明天截止", "马上截止", "deadline", "last day to"],
    UrgencyLevel.MEDIUM:   ["这周截止", "本周截止", "快截止", "closing soon"],
}


# ── 实体抽取（规则）──────────────────────────────────────────────────────────
# 课号：cse100 / CSE-100 / cse 100 / CSE 8A / MATH 20C → "CSE 100" 规范形
_COURSE_CODE_RE = re.compile(r"\b([A-Za-z]{2,4})[\s\-_]*(\d{1,3}[A-Za-z]{0,2})\b")
# 学期代码本身（FA26）会被课号正则误命中，需要排除；再加常见误报词。
_NON_SUBJECT_WORDS = {"GPA", "THE", "AND", "FOR", "TOP", "GE", "VAC", "HOLD"}
_TERM_CODE_RE   = re.compile(r"\b(FA|WI|SP)(\d{2})\b", re.I)
_SUMMER_CODE_RE = re.compile(r"\bS([123])(\d{2})\b", re.I)
_TERM_WORD_PATTERNS = [
    (re.compile(r"\b(?:fall|autumn)\s*(?:of\s*)?(?:20)?(\d{2})\b", re.I), "FA"),
    (re.compile(r"\bwinter\s*(?:of\s*)?(?:20)?(\d{2})\b", re.I), "WI"),
    (re.compile(r"\bspring\s*(?:of\s*)?(?:20)?(\d{2})\b", re.I), "SP"),
    (re.compile(r"\bsummer\s*(?:session\s*)?1\s*(?:of\s*)?(?:20)?(\d{2})\b", re.I), "S1"),
    (re.compile(r"\bsummer\s*(?:session\s*)?2\s*(?:of\s*)?(?:20)?(\d{2})\b", re.I), "S2"),
    (re.compile(r"(?:20)?(\d{2})\s*年?\s*秋(?:季|天)?"), "FA"),
    (re.compile(r"(?:20)?(\d{2})\s*年?\s*冬(?:季|天)?"), "WI"),
    (re.compile(r"(?:20)?(\d{2})\s*年?\s*春(?:季|天)?"), "SP"),
]
_RELATIVE_TERM_WORDS = ["下学期", "下个学期", "next quarter", "next term", "next semester"]
_INSTRUCTOR_PATTERNS = [
    re.compile(r"(?:[Pp]rofessor|[Pp]rof\.?|[Dd]r\.?)\s+([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][A-Za-z'’\-]+)?)"),
    re.compile(r"([一-鿿A-Za-z'’\-]{2,20})\s*(?:教授|老师)"),
]
_UNITS_RE = re.compile(r"(\d{1,2})\s*(?:个?\s*学分|units?|credits?)", re.I)


def _cosine(a: List[float], b: List[float]) -> float:
    """纯 Python 余弦相似度，不依赖 numpy。"""
    dot = sum(x * y for x, y in zip(a, b))
    na  = sum(x * x for x in a) ** 0.5
    nb  = sum(x * x for x in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


class IntentRecognizer:
    """
    端到端意图识别器。

    初始化时不加载任何本地模型，所有 AI 能力通过 Anthropic API 调用。
    模板 Embedding 在首次请求时懒加载并缓存，后续复用。
    """

    def __init__(
        self,
        api_key: str,
        base_url: Optional[str] = None,
        model: str = "claude-3-5-sonnet-20241022",
        confidence_threshold: float = 0.5,
    ):
        kwargs: Dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        self.client    = AsyncAnthropic(**kwargs)
        self.model     = model
        self.threshold = confidence_threshold
        # 第三方兼容 API（如 DeepSeek）通常不支持 Embedding，禁用该策略。
        # 官方 Anthropic SDK 当前没有 embeddings 资源，因此下面会使用稳定的
        # 本地字符 n-gram 向量作为轻量兜底，保证三路融合链路真实可跑。
        self._embedding_enabled = not bool(base_url)

        self._tpl_embeddings: Dict[IntentCategory, List[List[float]]] = {}
        self._cache: Dict[str, IntentResult] = {}
        self.cache_hits   = 0
        self.cache_misses = 0

    # ── 公开接口 ──────────────────────────────────────────────────────────────

    async def recognize(
        self,
        message: str,
        history: Optional[List[Dict[str, str]]] = None,
    ) -> IntentResult:
        """
        识别用户意图。

        history 格式：[{"role": "user"/"assistant", "content": "..."}]
        """
        key = self._cache_key(message, history)
        if key in self._cache:
            self.cache_hits += 1
            return self._cache[key]
        self.cache_misses += 1

        t0 = time.monotonic()

        # LLM 和 Embedding 并行（Embedding 不可用时跳过）
        llm_task = asyncio.create_task(self._llm_recognize(message, history))
        emb_task = asyncio.create_task(self._embedding_recognize(message)) if self._embedding_enabled else None
        pat      = self._pattern_recognize(message)

        if emb_task:
            llm, emb = await asyncio.gather(llm_task, emb_task)
        else:
            llm = await llm_task
            emb = {"intent": IntentCategory.OTHER, "confidence": 0.0}

        intent, confidence, source_scores = self._vote(llm, emb, pat)
        entities = self._extract_entities(message)
        urgency  = self._urgency(message, intent)

        result = IntentResult(
            intent=intent,
            confidence=confidence,
            urgency=urgency,
            intent_group=self._intent_group(intent),
            entities=entities,
            reasoning=llm.get("reasoning", ""),
            latency_ms=(time.monotonic() - t0) * 1000,
            source_scores=source_scores,
        )

        # LRU 缓存
        if len(self._cache) >= 1000:
            for k in list(self._cache)[:500]:
                del self._cache[k]
        self._cache[key] = result
        return result

    def learn(self, message: str, correct: IntentCategory) -> None:
        """在线学习：将纠正样本加入模板，清除对应 Embedding 缓存。"""
        tpls = _TEMPLATES.setdefault(correct, [])
        if message not in tpls:
            tpls.append(message)
            self._tpl_embeddings.pop(correct, None)  # 下次重新计算
            logger.info(f"学习新样本 → {correct.value}: {message[:40]}")

    # ── 三路识别策略 ──────────────────────────────────────────────────────────

    async def _llm_recognize(
        self,
        message: str,
        history: Optional[List[Dict[str, str]]],
    ) -> Dict[str, Any]:
        """策略 1：LLM 语义理解（Few-shot + 上下文）。"""
        message = self._clean_text(message)
        # 构建 Few-shot 示例
        examples = "\n".join(
            f'  消息: "{t}" → 意图: {cat.value}'
            for cat, tpls in _TEMPLATES.items()
            for t in tpls[:1]  # 每类取 1 条，控制 prompt 长度
        )
        # 最近 3 轮对话上下文
        ctx = ""
        if history:
            ctx = "\n最近对话:\n" + "\n".join(
                f"  {self._clean_text(m.get('role', 'user'))}: {self._clean_text(m.get('content', ''))}"
                for m in history[-3:]
            )

        prompt = f"""你是 UCSD 课程问答助手（CourseHub）的意图分析专家。根据示例判断用户意图，返回 JSON。
用户可能用中文或英文提问。如果问题能匹配细粒度意图，请优先返回细粒度意图，而不是宽泛意图组。
例如问先修优先返回 prerequisites，问名额优先返回 availability，问成绩分布优先返回 grades_history；
个案事务（enrollment hold、petition、waiver、成绩申诉）返回 advisor_referral。

示例:
{examples}

{ctx}
用户消息: "{message}"

返回格式（仅 JSON，不要其他文字）:
{{"intent": "<意图值>", "confidence": <0-1>, "reasoning": "<一句话说明>"}}

可选意图: {", ".join(c.value for c in IntentCategory)}"""
        prompt = self._clean_text(prompt)

        try:
            resp = await self.client.messages.create(
                model=self.model,
                max_tokens=256,
                temperature=0.1,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = extract_text_content(resp.content)
            s, e = raw.find("{"), raw.rfind("}") + 1
            data = json.loads(raw[s:e])
            try:
                data["intent"] = IntentCategory(data["intent"])
            except ValueError:
                data["intent"] = IntentCategory.OTHER
            return data
        except Exception as ex:
            logger.warning(f"LLM 识别失败: {ex}")
            return {"intent": IntentCategory.OTHER, "confidence": 0.0, "reasoning": "LLM 失败", "failed": True}

    async def _embedding_recognize(self, message: str) -> Dict[str, Any]:
        """策略 2：Embedding 向量相似度匹配。"""
        try:
            await self._load_template_embeddings()
            msg_vec = await self._embed_text(message)

            best_cat, best_score = IntentCategory.OTHER, 0.0
            for cat, vecs in self._tpl_embeddings.items():
                score = max(_cosine(msg_vec, v) for v in vecs)
                if score > best_score:
                    best_score, best_cat = score, cat

            return {"intent": best_cat, "confidence": best_score}
        except Exception as ex:
            logger.warning(f"Embedding 识别失败: {ex}")
            return {"intent": IntentCategory.OTHER, "confidence": 0.0}

    def _pattern_recognize(self, message: str) -> Dict[str, Any]:
        """策略 3：关键词模式匹配（同步，零延迟兜底，中英双语）。"""
        msg = message.lower()
        specific_patterns = {
            IntentCategory.ADVISOR_REFERRAL: [
                "hold", "petition", "waiver", "申诉", "豁免", "accommodation",
                "找谁办", "who do i contact", "找advisor", "找 advisor",
            ],
            IntentCategory.PREREQUISITES: [
                "先修", "先决条件", "选课限制", "prerequisite", "prereq", "restriction",
            ],
            IntentCategory.AVAILABILITY: [
                "还有位置", "有位置吗", "名额", "满了吗", "还能选", "waitlist",
                "space left", "seats", "seat left", "is it full", "open spots",
            ],
            IntentCategory.SCHEDULE: [
                "什么时候上", "几点上课", "上课时间", "教室", "哪个教学楼",
                "when does", "what time", "meeting time", "where is the class",
            ],
            IntentCategory.INSTRUCTOR_LOOKUP: [
                "谁教", "谁上", "教授是谁", "who teaches", "who is teaching", "taught by",
            ],
            IntentCategory.GRADES_HISTORY: [
                "gpa", "成绩分布", "给分", "平均分", "grade distribution", "past grades",
            ],
            IntentCategory.COURSE_SEARCH: [
                "有哪些", "哪些课", "找课", "找找", "what courses", "which courses",
                "courses are offered", "满足 ge", "ge 课",
            ],
            IntentCategory.COURSE_OVERVIEW: [
                "讲什么", "介绍一下", "是什么课", "课程内容", "几个学分", "几学分",
                "what is", "about?", "how many units", "course description",
            ],
            IntentCategory.PLAN_SEQUENCE: [
                "先修哪门", "该先修", "先上哪", "修课顺序", "什么顺序", "before or after",
                "take first", "order should i take",
            ],
            IntentCategory.WORKLOAD_ADVICE: [
                "会不会太累", "负担", "太重", "同时上", "一起上", "workload", "too much", "too heavy",
            ],
            IntentCategory.PROFESSOR_CHOICE: [
                "哪个教授好", "选哪个教授", "section", "教得怎么样",
                "which professor", "better professor",
            ],
            IntentCategory.META_INFO: [
                "数据来源", "数据多新", "什么时候更新", "数据是什么时候", "能回答哪些", "能做什么",
                "how fresh", "data source", "what can you do", "how recent",
            ],
            IntentCategory.GREETING: ["你好", "您好", "早上好", "下午好", "hello", "hi there"],
        }
        generic_patterns = {
            IntentCategory.ESCALATION: ["advisor", "vac", "官方渠道", "找人工", "人工"],
            IntentCategory.PLANNING:   ["建议", "推荐", "规划", "该不该", "怎么选", "should i", "plan my"],
            IntentCategory.FACTS:      ["?", "？", "怎么", "什么", "哪", "when", "what", "who", "which"],
            IntentCategory.GENERAL:    ["帮我", "谢谢", "thanks", "help", "please"],
        }

        best_cat, best_score = self._best_pattern_match(msg, specific_patterns)
        if best_cat != IntentCategory.OTHER:
            return {"intent": best_cat, "confidence": best_score}

        best_cat, best_score = self._best_pattern_match(msg, generic_patterns)
        return {"intent": best_cat, "confidence": best_score}

    # ── 投票合并 ──────────────────────────────────────────────────────────────

    def _vote(self, llm: Dict, emb: Dict, pat: Dict) -> tuple[IntentCategory, float, Dict[str, float]]:
        """加权投票。返回最终意图、融合置信度和各路来源得分。"""
        source_scores = {
            "llm": float(llm.get("confidence", 0.0) or 0.0),
            "embedding": float(emb.get("confidence", 0.0) or 0.0),
            "pattern": float(pat.get("confidence", 0.0) or 0.0),
        }
        if llm.get("failed"):
            if emb.get("intent") != IntentCategory.OTHER and emb.get("confidence", 0.0) > 0:
                return emb["intent"], source_scores["embedding"], source_scores
            if pat.get("intent") != IntentCategory.OTHER and pat.get("confidence", 0.0) > 0:
                return pat["intent"], source_scores["pattern"], source_scores
            return IntentCategory.OTHER, 0.0, source_scores

        if self._embedding_enabled:
            weights = [(llm, 0.7), (emb, 0.2), (pat, 0.1)]
        else:
            weights = [(llm, 0.85), (pat, 0.15)]
        scores: Dict[IntentCategory, float] = {}
        for result, w in weights:
            cat  = result.get("intent", IntentCategory.OTHER)
            conf = result.get("confidence", 0.0)
            scores[cat] = scores.get(cat, 0.0) + w * conf

        best = max(scores, key=scores.get)  # type: ignore
        best_score = scores[best]
        pat_intent = pat.get("intent", IntentCategory.OTHER)
        pat_conf = float(pat.get("confidence", 0.0) or 0.0)
        if best in _GENERIC_INTENTS and pat_intent in _SPECIFIC_INTENTS and pat_conf >= 0.5 and best_score < 0.8:
            source_scores["refined_by_pattern"] = pat_conf
            return pat_intent, max(best_score, pat_conf), source_scores
        if best_score < self.threshold:
            return IntentCategory.OTHER, best_score, source_scores
        return best, best_score, source_scores

    # ── 实体提取 ──────────────────────────────────────────────────────────────

    def _extract_entities(self, message: str) -> Dict[str, List[str]]:
        """用规则提取高价值实体，避免每次识别都额外调用 LLM。

        course_code / term 的归一化契约与结构化索引一致（如 "cse100" → "CSE 100"，
        "Fall 2026" → "FA26"）。instructor 当前用称谓模式兜底，全量教授词典
        由数据预处理产出后接入。
        """
        message = self._clean_text(message)
        return {
            "course_code": self._extract_course_codes(message),
            "term": self._extract_terms(message),
            "subject": self._unique(
                code.split(" ")[0] for code in self._extract_course_codes(message)
            ),
            "instructor": self._extract_instructors(message),
            "units": self._unique(_UNITS_RE.findall(message)),
        }

    def _extract_course_codes(self, message: str) -> List[str]:
        codes = []
        for m in _COURSE_CODE_RE.finditer(message):
            subject, number = m.group(1).upper(), m.group(2).upper()
            # 排除学期代码（FA26/WI25/SP26）和常见非科目词
            if subject in ("FA", "WI", "SP") and re.fullmatch(r"\d{2}", number):
                continue
            if subject in _NON_SUBJECT_WORDS:
                continue
            codes.append(f"{subject} {number}")
        return self._unique(codes)

    def _extract_terms(self, message: str) -> List[str]:
        terms = []
        for m in _TERM_CODE_RE.finditer(message):
            terms.append(f"{m.group(1).upper()}{m.group(2)}")
        for m in _SUMMER_CODE_RE.finditer(message):
            terms.append(f"S{m.group(1)}{m.group(2)}")
        for pattern, prefix in _TERM_WORD_PATTERNS:
            for m in pattern.finditer(message):
                terms.append(f"{prefix}{m.group(1)[-2:]}")
        msg_lower = message.lower()
        if any(word in msg_lower for word in _RELATIVE_TERM_WORDS):
            terms.append(ACTIVE_PLANNING_TERM)
        return self._unique(terms)

    def _extract_instructors(self, message: str) -> List[str]:
        names = []
        for pattern in _INSTRUCTOR_PATTERNS:
            names.extend(pattern.findall(message))
        return self._unique(names)

    # ── 辅助 ──────────────────────────────────────────────────────────────────

    async def _load_template_embeddings(self) -> None:
        """懒加载所有模板的 Embedding（只在首次调用时执行）。"""
        missing = [cat for cat in _TEMPLATES if cat not in self._tpl_embeddings]
        if not missing:
            return

        all_texts = [t for cat in missing for t in _TEMPLATES[cat]]
        vecs = [await self._embed_text(text) for text in all_texts]
        idx = 0
        for cat in missing:
            n = len(_TEMPLATES[cat])
            self._tpl_embeddings[cat] = vecs[idx: idx + n]
            idx += n

    async def _embed_text(self, text: str) -> List[float]:
        """
        生成文本向量。

        如果未来接入的官方/兼容客户端提供 embeddings.create，会优先使用远端向量；
        当前 Anthropic SDK 没有该资源时，退化为字符 n-gram 哈希向量。这样不会因为
        Embedding 服务缺失导致三路融合中断。
        """
        embeddings = getattr(self.client, "embeddings", None)
        if embeddings is not None:
            try:
                resp = await embeddings.create(model="voyage-3-lite", input=[text])
                return list(resp.data[0].embedding)
            except Exception as ex:
                logger.warning(f"远端 Embedding 失败，使用本地向量兜底: {ex}")

        return self._local_embedding(text)

    @staticmethod
    def _local_embedding(text: str, dims: int = 256) -> List[float]:
        """稳定的字符 n-gram 哈希向量，用于无远端 Embedding 时的语义近似匹配。"""
        normalized = text.lower().strip()
        vec = [0.0] * dims
        tokens = set()
        for n in (1, 2, 3):
            if len(normalized) >= n:
                tokens.update(normalized[i:i + n] for i in range(len(normalized) - n + 1))
        if not tokens:
            tokens.add(normalized)

        for token in tokens:
            digest = hashlib.md5(token.encode("utf-8")).digest()
            idx = int.from_bytes(digest[:4], "big") % dims
            sign = 1.0 if digest[4] % 2 == 0 else -1.0
            vec[idx] += sign
        return vec

    def _urgency(self, message: str, intent: IntentCategory) -> UrgencyLevel:
        msg = message.lower()
        for level, kws in _URGENCY_KEYWORDS.items():
            if any(kw in msg for kw in kws):
                return level
        if intent in (IntentCategory.ESCALATION, IntentCategory.ADVISOR_REFERRAL):
            return UrgencyLevel.HIGH
        return UrgencyLevel.LOW

    def _cache_key(self, message: str, history: Optional[List[Dict[str, str]]] = None) -> str:
        payload = {"message": self._clean_text(message)[:200]}
        if history:
            payload["history"] = [
                {
                    "role": self._clean_text(item.get("role", ""))[:20],
                    "content": self._clean_text(item.get("content", ""))[:160],
                }
                for item in history[-3:]
            ]
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
        return hashlib.md5(raw.encode("utf-8")).hexdigest()

    @staticmethod
    def _unique(values) -> List[str]:
        return list(dict.fromkeys(value.strip() for value in values if value and value.strip()))

    @staticmethod
    def _best_pattern_match(
        message: str,
        patterns: Dict[IntentCategory, List[str]],
    ) -> tuple[IntentCategory, float]:
        best_cat, best_score = IntentCategory.OTHER, 0.0
        for cat, kws in patterns.items():
            hits = sum(1 for kw in kws if kw in message)
            if not hits:
                continue
            # 单个明确业务关键词就给可用置信度；多个关键词命中时提高置信度。
            score = min(1.0, 0.5 + 0.25 * (hits - 1))
            if score > best_score:
                best_score, best_cat = score, cat
        return best_cat, best_score

    @staticmethod
    def _intent_group(intent: IntentCategory) -> str:
        return _INTENT_GROUPS.get(intent, intent).value

    @staticmethod
    def _clean_text(value: Any) -> str:
        """移除 Unicode 代理字符，避免 HTTP 客户端编码 prompt 时崩溃。"""
        if value is None:
            return ""
        if not isinstance(value, str):
            value = str(value)
        return value.encode("utf-8", errors="ignore").decode("utf-8")

    @property
    def cache_stats(self) -> Dict[str, Any]:
        total = self.cache_hits + self.cache_misses
        return {
            "size": len(self._cache),
            "hits": self.cache_hits,
            "misses": self.cache_misses,
            "hit_rate": self.cache_hits / total if total else 0.0,
        }
