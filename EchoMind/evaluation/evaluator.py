"""
亮点：端到端 Agent 评测框架

核心问题：如何评测端到端 Agent？

评测维度：
  1. 意图识别准确率 —— 预测意图 vs 标注意图，计算 Accuracy / F1
  2. 响应质量评分 —— 用 LLM 作为评判者（LLM-as-Judge），
     从相关性、准确性、完整性、有用性四个维度打分
  3. 端到端对话评测 —— 模拟完整多轮对话，评估整体体验
  4. 回归测试 —— 与历史基线对比，防止性能退化

LLM-as-Judge 是评测 Agent 质量的关键技术：
  人工标注成本高、主观性强；用 LLM 评判可以规模化、可重复。
"""
import asyncio
import json
import logging
import pathlib
import re
import statistics
import time
from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional

from anthropic import AsyncAnthropic

from core.llm_utils import AUX_MAX_TOKENS, extract_text_content

from core.intent_recognizer import IntentCategory, IntentRecognizer

logger = logging.getLogger(__name__)


_SNAPSHOT_DATE_RE = re.compile(r"20\d{2}(?:-|年)\d{1,2}(?:-|月)\d{1,2}")
_TERM_CODE_RE = re.compile(r"\b(?:FA|WI|SP|S[123])\d{2}\b", re.I)
_NON_LIVE_MARKERS = ("非实时", "不是实时", "not live", "not real-time", "snapshot")
_NO_AGGREGATE_MARKERS = (
    "不合成", "不会合成", "不会把", "不提供单一", "不能合成", "不应合成",
    "do not aggregate", "won't aggregate", "no single course gpa",
)
_PLANNING_DISCLAIMERS = (
    "本建议为非官方参考，选课决策请咨询学校学业顾问。",
    "unofficial suggestion — please confirm with your academic counselor.",
)
_OFFICIAL_CHANNEL_MARKERS = (
    "virtual advising center", "advisor", "webreg", "院系", "学院", "官方渠道",
)


def check_dialog_constraints(
    constraints: List[str],
    *,
    response: str,
    intent: str,
    agent_type: str,
    escalated: bool,
    entities: Dict[str, List[str]],
    expected_intent: Optional[str] = None,
    expected_agent_type: Optional[str] = None,
) -> List[str]:
    """对默认验收用例执行确定性硬约束检查，补足 LLM Judge 的主观评分。"""
    failures: List[str] = []
    lowered = response.lower()
    if expected_intent and intent != expected_intent:
        failures.append(f"route: expected intent {expected_intent}, got {intent}")
    if expected_agent_type and agent_type != expected_agent_type:
        failures.append(f"route: expected agent {expected_agent_type}, got {agent_type}")
    if "availability_snapshot" in constraints:
        if not _SNAPSHOT_DATE_RE.search(response):
            failures.append("availability_snapshot: missing snapshot timestamp")
        if not any(marker in lowered for marker in _NON_LIVE_MARKERS):
            failures.append("availability_snapshot: missing non-live disclaimer")
    if "course_context" in constraints and "CSE 100" not in entities.get("course_code", []):
        failures.append("course_context: missing CSE 100 entity")
    if "grade_history" in constraints:
        if not any(marker in lowered for marker in _NO_AGGREGATE_MARKERS):
            failures.append("grade_history: missing refusal to synthesize course GPA")
        has_instructor = (
            "教授" in response
            or "instructor" in lowered
            or bool(re.search(r"[A-Z][A-Za-z'’\-]+,\s*[A-Z]", response))
        )
        if not (_TERM_CODE_RE.search(response) and has_instructor and "gpa" in lowered):
            failures.append("grade_history: missing instructor-by-term evidence")
    if "planning_disclaimer" in constraints:
        if agent_type != "planning":
            failures.append("planning_disclaimer: expected planning agent")
        if not any(disclaimer in lowered for disclaimer in _PLANNING_DISCLAIMERS):
            failures.append("planning_disclaimer: missing disclaimer")
    if "advisor_referral" in constraints:
        if not escalated:
            failures.append("advisor_referral: escalated flag is false")
        if "[转介]" not in response and "[referral]" not in lowered:
            failures.append("advisor_referral: missing referral marker")
        if not any(marker in lowered for marker in _OFFICIAL_CHANNEL_MARKERS):
            failures.append("advisor_referral: missing official channel")
    return failures


# ── 数据结构 ──────────────────────────────────────────────────────────────────

@dataclass
class IntentTestCase:
    message:          str
    expected_intent:  str
    context:          Optional[Dict[str, Any]] = None


@dataclass
class QualityScores:
    """LLM-as-Judge 评分结果。"""
    relevance:    float   # 相关性：回答是否针对问题
    accuracy:     float   # 准确性：信息是否正确
    completeness: float   # 完整性：是否完整解决问题
    helpfulness:  float   # 有用性：用户是否能据此行动
    judge_failed: bool = False
    error: Optional[str] = None

    @property
    def overall(self) -> float:
        return statistics.mean([self.relevance, self.accuracy, self.completeness, self.helpfulness])


@dataclass
class EvalResult:
    test_id:    str
    passed:     bool
    scores:     Dict[str, float]
    detail:     str = ""
    metadata:   Dict[str, Any] = field(default_factory=dict)


@dataclass
class EvalReport:
    """评测报告。"""
    timestamp:        str
    total:            int
    passed:           int
    pass_rate:        float
    avg_scores:       Dict[str, float]
    regressions:      List[str]          # 相比基线退化的指标
    recommendations:  List[str]
    results:          List[EvalResult]


# ── LLM-as-Judge ─────────────────────────────────────────────────────────────

class LLMJudge:
    """
    用 LLM 评判 Agent 响应质量。

    为什么用 LLM 而不是人工？
    - 可规模化：数千条测试用例自动评测
    - 可重复：相同输入得到稳定评分
    - 多维度：同时评估相关性、准确性等多个维度

    注意：LLM Judge 本身也有偏差，建议定期用人工标注校准。
    """

    JUDGE_PROMPT = """你是课程问答质量评估专家。CourseHub 是回答 UCSD 课程问题的助手。请对以下响应评分。

用户问题: {question}
Agent 响应: {response}
{context_section}

评分时注意 CourseHub 的回答安全约束：名额/座位数字应带数据快照时间并说明非实时；
成绩历史应按 教授 × 学期 列出而不是合成单一课程 GPA；数据没有覆盖时应如实说明而不是编造；
选课规划建议应附非官方免责声明。违反这些约束应在 accuracy/helpfulness 上扣分；
如实说明"数据未覆盖"不应因为没给出具体数字而在 completeness 上被重罚。

请从以下四个维度评分（0.0-1.0），返回 JSON：
- relevance: 响应是否直接针对用户问题（0=完全无关，1=完全相关）
- accuracy: 信息是否准确、是否遵守回答安全约束（0=明显错误或编造，1=完全正确）
- completeness: 是否完整回应了用户需求（0=完全没回应，1=完全回应）
- helpfulness: 用户能否据此采取行动（0=毫无帮助，1=非常有帮助）

只返回 JSON，例如: {{"relevance": 0.9, "accuracy": 0.8, "completeness": 0.7, "helpfulness": 0.85}}"""

    def __init__(self, client: AsyncAnthropic, model: str):
        self._client = client
        self._model  = model

    async def judge(
        self,
        question: str,
        response: str,
        context: Optional[str] = None,
    ) -> QualityScores:
        ctx_section = f"背景信息: {context}" if context else ""
        prompt = self.JUDGE_PROMPT.format(
            question=question,
            response=response,
            context_section=ctx_section,
        )
        prompt = self._clean_text(prompt)
        try:
            resp = await self._client.messages.create(
                model=self._model, max_tokens=AUX_MAX_TOKENS, temperature=0.0,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = extract_text_content(resp.content)
            s, e = raw.find("{"), raw.rfind("}") + 1
            data = json.loads(raw[s:e])
            return QualityScores(
                relevance=float(data.get("relevance", 0.5)),
                accuracy=float(data.get("accuracy", 0.5)),
                completeness=float(data.get("completeness", 0.5)),
                helpfulness=float(data.get("helpfulness", 0.5)),
            )
        except Exception as ex:
            logger.warning(f"LLM Judge 失败: {ex}")
            return QualityScores(
                0.5, 0.5, 0.5, 0.5,
                judge_failed=True,
                error=str(ex),
            )

    @staticmethod
    def _clean_text(value: Any) -> str:
        """移除 Unicode 代理字符，避免 LLM 请求编码失败。"""
        if value is None:
            return ""
        if not isinstance(value, str):
            value = str(value)
        return value.encode("utf-8", errors="ignore").decode("utf-8")


# ── 意图识别评测 ──────────────────────────────────────────────────────────────

class IntentEvaluator:
    """评测意图识别的准确率和 F1。"""

    def __init__(self, recognizer: IntentRecognizer):
        self._recognizer = recognizer

    async def evaluate(self, cases: List[IntentTestCase]) -> Dict[str, Any]:
        predictions, ground_truth = [], []
        case_details: List[Dict[str, Any]] = []

        for case in cases:
            result = await self._recognizer.recognize(case.message)
            predicted = result.intent.value
            predictions.append(predicted)
            ground_truth.append(case.expected_intent)
            case_details.append({
                "message": case.message,
                "expected": case.expected_intent,
                "predicted": predicted,
                "confidence": result.confidence,
                "reasoning": result.reasoning,
            })

        # 纯 Python 计算指标
        correct = sum(p == g for p, g in zip(predictions, ground_truth))
        accuracy = correct / len(predictions) if predictions else 0.0

        # 每类 F1
        labels = sorted(set(ground_truth + predictions))
        per_class: Dict[str, Dict[str, float]] = {}
        for label in labels:
            tp = sum(p == label and g == label for p, g in zip(predictions, ground_truth))
            fp = sum(p == label and g != label for p, g in zip(predictions, ground_truth))
            fn = sum(p != label and g == label for p, g in zip(predictions, ground_truth))
            prec = tp / (tp + fp) if (tp + fp) else 0.0
            rec  = tp / (tp + fn) if (tp + fn) else 0.0
            f1   = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
            per_class[label] = {"precision": prec, "recall": rec, "f1": f1}

        macro_f1 = statistics.mean(v["f1"] for v in per_class.values()) if per_class else 0.0

        return {
            "accuracy":   round(accuracy, 4),
            "macro_f1":   round(macro_f1, 4),
            "per_class":  per_class,
            "total":      len(cases),
            "correct":    correct,
            "cases":      case_details,
        }


# ── 端到端评测器 ──────────────────────────────────────────────────────────────

class EndToEndEvaluator:
    """
    端到端 Agent 评测。

    评测流程：
      1. 运行意图识别评测（准确率/F1）
      2. 运行对话质量评测（LLM-as-Judge）
      3. 与历史基线对比（回归检测）
      4. 生成可操作的优化建议
    """

    # 质量及格线
    PASS_THRESHOLD = 0.75

    def __init__(
        self,
        orchestrator,
        recognizer: IntentRecognizer,
        api_key:  str,
        base_url: Optional[str] = None,
        model:    str = "claude-3-5-sonnet-20241022",
        baseline_path: Optional[str] = None,
        context_builder=None,
    ):
        kwargs: Dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        client = AsyncAnthropic(**kwargs)

        self._orchestrator     = orchestrator
        self._recognizer       = recognizer
        self._judge            = LLMJudge(client, model)
        self._intent_evaluator = IntentEvaluator(recognizer)
        # 与 /chat 相同的检索上下文构建器（async (message, intent, entities) -> str）。
        # 不传则对话评测在无检索状态下运行，评测的就不是生产管线。
        self._context_builder  = context_builder
        self._history:         List[EvalReport] = []
        self._baseline_path = pathlib.Path(baseline_path) if baseline_path else None
        self._baseline: Optional[EvalReport] = self._load_baseline()

    async def run(
        self,
        intent_cases:    Optional[List[IntentTestCase]] = None,
        dialog_cases:    Optional[List[Dict[str, Any]]] = None,
    ) -> EvalReport:
        """
        运行完整评测。

        intent_cases: 意图识别测试用例
        dialog_cases:
          - 单轮: [{"question": "..."}]
          - 多轮: [{"turns": ["第一轮", "第二轮", ...]}]
        """
        results: List[EvalResult] = []
        all_scores: Dict[str, List[float]] = {
            "relevance": [], "accuracy": [], "completeness": [], "helpfulness": []
        }

        # 1. 意图识别评测
        intent_metrics: Dict[str, Any] = {}
        if intent_cases:
            intent_metrics = await self._intent_evaluator.evaluate(intent_cases)
            passed = intent_metrics["accuracy"] >= self.PASS_THRESHOLD
            results.append(EvalResult(
                test_id="intent_recognition",
                passed=passed,
                scores={"accuracy": intent_metrics["accuracy"], "macro_f1": intent_metrics["macro_f1"]},
                detail=f"准确率 {intent_metrics['accuracy']:.1%}，Macro-F1 {intent_metrics['macro_f1']:.3f}",
                metadata={
                    "total": intent_metrics.get("total", 0),
                    "correct": intent_metrics.get("correct", 0),
                    "cases": intent_metrics.get("cases", []),
                },
            ))

        # 2. 对话质量评测（调用 orchestrator 产出回复，再用 LLM Judge 评分）
        if dialog_cases:
            for i, case in enumerate(dialog_cases):
                case_results = await self._evaluate_dialog_case(case, i)
                results.extend(case_results)
                for r in case_results:
                    for k in all_scores:
                        if k in r.scores:
                            all_scores[k].append(r.scores[k])

        # 3. 汇总
        avg_scores = {
            k: round(statistics.mean(v), 4) for k, v in all_scores.items() if v
        }
        if intent_metrics:
            avg_scores["intent_accuracy"] = intent_metrics["accuracy"]

        passed_count = sum(1 for r in results if r.passed)
        pass_rate    = passed_count / len(results) if results else 0.0

        # 4. 回归检测
        regressions = self._detect_regressions(avg_scores)

        # 5. 优化建议
        recommendations = self._recommendations(avg_scores, intent_metrics)

        report = EvalReport(
            timestamp=datetime.now().isoformat(),
            total=len(results),
            passed=passed_count,
            pass_rate=round(pass_rate, 4),
            avg_scores=avg_scores,
            regressions=regressions,
            recommendations=recommendations,
            results=results,
        )
        self._history.append(report)
        self._save_baseline(report)
        return report

    async def _evaluate_dialog_case(self, case: Dict[str, Any], case_idx: int) -> List[EvalResult]:
        """评测单轮或多轮对话用例。"""
        from agents.agent_orchestrator import Request as OrcReq

        questions = self._dialog_turns(case)
        if not questions:
            return []

        conv_id = str(case.get("conv_id") or f"eval_{case_idx}")
        user_id = str(case.get("user_id") or "eval_user")
        history: List[Dict[str, str]] = []
        results: List[EvalResult] = []

        for turn_idx, question in enumerate(questions):
            turn_history = history[-6:] if history else None
            # 与 /chat 主链路同构：先识别意图/实体，再构建混合检索上下文，
            # 否则评测的是一条没有数据接入的假管线。
            intent_result = await self._recognizer.recognize(question, history=turn_history)
            knowledge_text = ""
            if self._context_builder is not None:
                try:
                    built = await self._context_builder(
                        question, intent_result.intent, intent_result.entities,
                    )
                    knowledge_text = built[0] if isinstance(built, tuple) else (built or "")
                except Exception as ex:
                    logger.warning(f"评测检索上下文构建失败: {ex}")
            context_parts = [p for p in (self._history_context(history), knowledge_text) if p]
            context = "\n\n".join(context_parts)
            orch_req = OrcReq(
                message=question,
                user_id=user_id,
                conv_id=conv_id,
                context=context,
                history=turn_history,
                entities=intent_result.entities,
                intent=intent_result.intent,
                intent_group=intent_result.intent_group,
                urgency=intent_result.urgency,
                intent_confidence=intent_result.confidence,
            )
            orch_result = await self._orchestrator.run(orch_req)
            actual_answer = orch_result.response

            scores = await self._judge.judge(question, actual_answer, context=context or None)
            expected_intents = case.get("expected_intents") or []
            expected_agents = case.get("expected_agent_types") or []
            expected_intent = (
                expected_intents[turn_idx]
                if turn_idx < len(expected_intents)
                else case.get("expected_intent")
            )
            expected_agent_type = (
                expected_agents[turn_idx]
                if turn_idx < len(expected_agents)
                else case.get("expected_agent_type")
            )
            constraint_failures = check_dialog_constraints(
                list(case.get("constraints") or []),
                response=actual_answer,
                intent=orch_result.intent.value if orch_result.intent else "other",
                agent_type=orch_result.agent_type.value,
                escalated=orch_result.escalated,
                entities=intent_result.entities,
                expected_intent=expected_intent,
                expected_agent_type=expected_agent_type,
            )
            passed = scores.overall >= self.PASS_THRESHOLD and not constraint_failures

            history.append({"role": "user", "content": question})
            history.append({"role": "assistant", "content": actual_answer})

            test_id = f"dialog_{case_idx}" if len(questions) == 1 else f"dialog_{case_idx}_turn_{turn_idx}"
            results.append(EvalResult(
                test_id=test_id,
                passed=passed,
                scores={
                    "relevance": scores.relevance,
                    "accuracy": scores.accuracy,
                    "completeness": scores.completeness,
                    "helpfulness": scores.helpfulness,
                    "overall": scores.overall,
                },
                detail=(
                    f"Q: {question[:30]}... → 综合评分 {scores.overall:.3f}"
                    + (f"；硬约束失败: {', '.join(constraint_failures)}" if constraint_failures else "")
                ),
                metadata={
                    "question": question,
                    "response": actual_answer,
                    "agent_type": orch_result.agent_type.value,
                    "intent": orch_result.intent.value if orch_result.intent else None,
                    "turn": turn_idx,
                    "conv_id": conv_id,
                    "judge_failed": scores.judge_failed,
                    "judge_error": scores.error,
                    "constraint_failures": constraint_failures,
                },
            ))

        return results

    @staticmethod
    def _dialog_turns(case: Dict[str, Any]) -> List[str]:
        turns = case.get("turns")
        if isinstance(turns, list):
            return [str(t) for t in turns if str(t).strip()]
        question = case.get("question")
        return [str(question)] if question else []

    @staticmethod
    def _history_context(history: List[Dict[str, str]]) -> str:
        if not history:
            return ""
        lines = [f"{m['role']}: {m['content']}" for m in history[-8:]]
        return "[评测多轮历史]\n" + "\n".join(lines)

    def _detect_regressions(self, current: Dict[str, float]) -> List[str]:
        """与上一次评测对比，找出退化超过 5% 的指标。"""
        prev_report = self._history[-1] if self._history else self._baseline
        if prev_report is None:
            return []
        prev = prev_report.avg_scores
        regressions = []
        for metric, value in current.items():
            if metric in prev and prev[metric] > 0:
                delta = (value - prev[metric]) / prev[metric]
                if delta < -0.05:
                    regressions.append(
                        f"{metric}: {prev[metric]:.3f} → {value:.3f} (退化 {abs(delta):.1%})"
                    )
        return regressions

    def _recommendations(
        self,
        scores: Dict[str, float],
        intent_metrics: Dict[str, Any],
    ) -> List[str]:
        recs = []
        if scores.get("intent_accuracy", 1.0) < 0.90:
            recs.append("意图识别准确率 < 90%：增加 Few-shot 示例，或对低 F1 的意图类别补充训练数据")
        if scores.get("relevance", 1.0) < 0.75:
            recs.append("相关性偏低：检查 Agent system_prompt，确保 Agent 聚焦于用户问题")
        if scores.get("completeness", 1.0) < 0.75:
            recs.append("完整性偏低：Agent 可能过早结束回答，考虑在 prompt 中要求提供完整解决方案")
        if scores.get("helpfulness", 1.0) < 0.75:
            recs.append("有用性偏低：回答可能过于抽象，考虑要求 Agent 提供具体操作步骤")
        if not recs:
            recs.append("所有指标均达标，继续保持")
        return recs

    @property
    def history(self) -> List[EvalReport]:
        return self._history

    def _load_baseline(self) -> Optional[EvalReport]:
        if not self._baseline_path or not self._baseline_path.exists():
            return None
        try:
            data = json.loads(self._baseline_path.read_text(encoding="utf-8"))
            return self._report_from_dict(data)
        except Exception as ex:
            logger.warning(f"读取评测基线失败: {ex}")
            return None

    def _save_baseline(self, report: EvalReport) -> None:
        if not self._baseline_path:
            return
        try:
            self._baseline_path.parent.mkdir(parents=True, exist_ok=True)
            self._baseline_path.write_text(
                json.dumps(asdict(report), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            self._baseline = report
        except Exception as ex:
            logger.warning(f"保存评测基线失败: {ex}")

    @staticmethod
    def _report_from_dict(data: Dict[str, Any]) -> EvalReport:
        return EvalReport(
            timestamp=data.get("timestamp", ""),
            total=int(data.get("total", 0)),
            passed=int(data.get("passed", 0)),
            pass_rate=float(data.get("pass_rate", 0.0)),
            avg_scores=dict(data.get("avg_scores", {})),
            regressions=list(data.get("regressions", [])),
            recommendations=list(data.get("recommendations", [])),
            results=[
                EvalResult(
                    test_id=r.get("test_id", ""),
                    passed=bool(r.get("passed", False)),
                    scores=dict(r.get("scores", {})),
                    detail=r.get("detail", ""),
                    metadata=dict(r.get("metadata", {})),
                )
                for r in data.get("results", [])
            ],
        )


# ── 内置测试用例（开箱即用）──────────────────────────────────────────────────

DEFAULT_INTENT_CASES: List[IntentTestCase] = [
    IntentTestCase("CSE 100 讲什么？",                            "course_overview"),
    IntentTestCase("What are the prerequisites for CSE 101?",    "prerequisites"),
    IntentTestCase("FA26 的 MATH 20C 什么时候上课？",             "schedule"),
    IntentTestCase("Is there space left in CSE 100?",            "availability"),
    IntentTestCase("谁教 CSE 100？",                              "instructor_lookup"),
    IntentTestCase("CSE 100 历年 GPA 怎么样？",                   "grades_history"),
    IntentTestCase("FA26 有哪些 4 学分的 CSE 课？",               "course_search"),
    IntentTestCase("我该先修 CSE 100 还是 CSE 101？",             "plan_sequence"),
    IntentTestCase("同时上 CSE 100 和 CSE 110 会不会太累？",       "workload_advice"),
    IntentTestCase("选 Kane 还是 Sahoo 的 section？",             "professor_choice"),
    IntentTestCase("你好",                                        "greeting"),
    IntentTestCase("你的数据是什么时候更新的？",                   "meta_info"),
    IntentTestCase("我的 enrollment hold 怎么解除？",              "advisor_referral"),
    IntentTestCase("今天天气怎么样",                              "other"),
]

DEFAULT_DIALOG_CASES: List[Dict[str, Any]] = [
    # 每条用例钉住一条回答安全约束（见 skills/course_facts/SKILL.md）
    {
        "turns": ["我想了解 CSE 100", "它的先修是什么？", "FA26 谁教这门课？"],
        "constraints": ["course_context"],
        "expected_intents": ["course_overview", "prerequisites", "instructor_lookup"],
        "expected_agent_types": ["course", "course", "course"],
    },
    {
        "question": "CSE 100 还有位置吗？",
        "constraints": ["availability_snapshot"],
        "expected_intent": "availability",
        "expected_agent_type": "course",
    },
    {
        "question": "CSE 100 的平均 GPA 是多少？",
        "constraints": ["grade_history"],
        "expected_intent": "grades_history",
        "expected_agent_type": "course",
    },
    {
        "question": "帮我规划大二秋季学期的课，我是 CS 专业",
        "constraints": ["planning_disclaimer"],
        "expected_agent_type": "planning",
    },
    {
        "question": "我的 prereq 被卡了怎么办？",
        "constraints": ["advisor_referral"],
        "expected_intent": "advisor_referral",
        "expected_agent_type": "general",
    },
]
