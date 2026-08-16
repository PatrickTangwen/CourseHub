"""
亮点：多 Agent 路由与编排

核心问题：多 Agent 情况下如何做 Routing？

路由策略（三层决策）：
  1. 领域路由 —— 按意图组、领域关键词和实体打分，选出主/辅 Agent
  2. 性能路由 —— 同类 Agent 有多个时，选成功率最高、延迟最低的
  3. 降级路由 —— 专属 Agent 不可用时，自动降级到 GeneralAgent

并行协作：
  - 复杂问题（如"课程事实 + 选课规划"）可同时派发给多个 Agent
  - 结果由 Orchestrator 合并后返回

升级机制：
  - 个案事务或 CRITICAL 紧急度 → 转介官方渠道（Advisor Referral）
"""
import asyncio
import json
import logging
import re
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional

from anthropic import AsyncAnthropic

from core.intent_recognizer import IntentCategory, IntentRecognizer, UrgencyLevel
from core.stage_events import emit_stage
from core.llm_utils import AGENT_MAX_TOKENS, extract_text_content

logger = logging.getLogger(__name__)


# ── 数据结构 ──────────────────────────────────────────────────────────────────

class AgentType(Enum):
    GENERAL   = "general"    # 接待/澄清/元信息
    COURSE    = "course"     # 课程事实
    PLANNING  = "planning"   # 选课规划建议


@dataclass
class AgentStats:
    """Agent 运行时统计，供 Monitor 和路由决策使用。"""
    total:     int   = 0
    success:   int   = 0
    total_ms:  float = 0.0
    monitor_penalty: float = 0.0

    @property
    def success_rate(self) -> float:
        return self.success / self.total if self.total else 1.0

    @property
    def avg_ms(self) -> float:
        return self.total_ms / self.total if self.total else 0.0

    def routing_score(self) -> float:
        """路由评分：成功率高、延迟低的 Agent 得分高。"""
        latency_score = 1.0 / (1.0 + self.avg_ms / 1000)
        base_score = self.success_rate * 0.7 + latency_score * 0.3
        return base_score * max(0.0, 1.0 - self.monitor_penalty)


@dataclass
class AgentResponse:
    agent_type:  AgentType
    content:     str
    success:     bool
    confidence:  float = 1.0
    latency_ms:  float = 0.0
    escalate:    bool  = False   # 是否需要升级


@dataclass
class Request:
    message:     str
    user_id:     str
    conv_id:     str
    context:     str = ""        # 来自 MemoryManager 的格式化上下文
    history:     Optional[List[Dict[str, str]]] = None  # 对话历史，传给意图识别
    entities:    Dict[str, List[str]] = field(default_factory=dict)
    intent:      Optional[IntentCategory] = None
    intent_group: Optional[str] = None
    urgency:     Optional[UrgencyLevel]   = None
    intent_confidence: float = 1.0
    request_id:  str = field(default_factory=lambda: str(uuid.uuid4())[:8])


@dataclass
class OrchestratorResult:
    request_id:  str
    response:    str
    agent_type:  AgentType
    intent:      Optional[IntentCategory]
    escalated:   bool  = False
    latency_ms:  float = 0.0
    agent_types: List[AgentType] = field(default_factory=list)
    primary_agent: Optional[AgentType] = None
    supporting_agents: List[AgentType] = field(default_factory=list)
    routing_reason: str = ""
    routing_confidence: float = 0.0


@dataclass
class RoutingDecision:
    """一次请求的结构化路由决策。"""
    primary_agent: AgentType
    supporting_agents: List[AgentType] = field(default_factory=list)
    reason: str = ""
    confidence: float = 0.0

    @property
    def agent_types(self) -> List[AgentType]:
        return [self.primary_agent] + self.supporting_agents

    @property
    def multi_agent(self) -> bool:
        return bool(self.supporting_agents)


# ── 基础 Agent ────────────────────────────────────────────────────────────────

class BaseAgent:
    """所有 Agent 的基类，封装 LLM 调用和统计。"""

    agent_type: AgentType
    system_prompt: str

    def __init__(self, client: AsyncAnthropic, model: str, skill_manager: Optional[Any] = None):
        self._client = client
        self._model  = model
        self._skill_manager = skill_manager
        self.stats   = AgentStats()

    async def handle(self, req: Request) -> AgentResponse:
        t0 = time.monotonic()
        self.stats.total += 1
        try:
            content = await self._call_llm(req)
            ms = (time.monotonic() - t0) * 1000
            self.stats.success += 1
            self.stats.total_ms += ms
            escalate = self._needs_escalation(content)
            return AgentResponse(
                agent_type=self.agent_type,
                content=content,
                success=True,
                latency_ms=ms,
                escalate=escalate,
            )
        except Exception as ex:
            ms = (time.monotonic() - t0) * 1000
            self.stats.total_ms += ms
            logger.error(f"{self.agent_type.value} 处理失败: {ex}")
            return AgentResponse(
                agent_type=self.agent_type,
                content="抱歉，处理您的请求时出现问题，请稍后重试。",
                success=False,
                latency_ms=ms,
            )

    async def _call_llm(self, req: Request) -> str:
        def _clean(s: str) -> str:
            return s.encode("utf-8", errors="ignore").decode("utf-8")

        messages = []
        if req.context:
            messages.append({"role": "user", "content": f"[背景信息]\n{_clean(req.context)}"})
            messages.append({"role": "assistant", "content": "好的，我已了解背景信息。"})
        if req.entities:
            entities_text = json.dumps(req.entities, ensure_ascii=False)
            messages.append({"role": "user", "content": f"[结构化实体]\n{_clean(entities_text)}"})
            messages.append({"role": "assistant", "content": "好的，我会结合这些结构化实体处理。"})
        messages.append({"role": "user", "content": _clean(req.message)})

        resp = await self._client.messages.create(
            model=self._model,
            max_tokens=AGENT_MAX_TOKENS,
            system=self._build_system_prompt(req),
            messages=messages,
        )
        content = extract_text_content(resp.content)
        if not content.strip():
            # 推理型模型可能只输出 thinking 块（如 max_tokens 耗尽），按失败处理走降级
            raise RuntimeError(f"LLM 返回空文本 (stop_reason={getattr(resp, 'stop_reason', None)})")
        return content

    def _build_system_prompt(self, req: Request) -> str:
        """把动态加载的 Skills 拼入 system prompt，让业务规则随请求生效。"""
        if self._skill_manager is None:
            return self.system_prompt
        skill_prompt = self._skill_manager.prompt_for(req.message, self.agent_type.value)
        if not skill_prompt:
            return self.system_prompt
        return f"{self.system_prompt}\n\n[动态 Skills]\n{skill_prompt}"

    def _needs_escalation(self, content: str) -> bool:
        """检测 Agent 是否真的把用户转介到了官方渠道。

        只认显式标记 [转介]/[referral]（persona 指示 Agent 在实际转介时输出）。
        不能用"官方渠道"等措辞做关键词：那是 Agent 被指示在说明能力边界时
        也会正常使用的短语，会把日常问答误报为转介。
        """
        lowered = content.lower()
        return "[转介]" in content or "[referral]" in lowered


class GeneralAgent(BaseAgent):
    agent_type    = AgentType.GENERAL
    system_prompt = (
        "你是 CourseHub 的接待助手。CourseHub 是回答 UCSD 课程问题的助手，"
        "数据来自课程目录快照（课程内容、先修、时间地点、名额、教授、成绩历史）。"
        "友好、简洁，用用户使用的语言（中文或英文）回答。"
        "你负责问候、说明系统能力与数据范围、以及在问题不明确时澄清需求。"
        "系统没有 CAPE/SET 教评数据，不能代用户注册选课，名额数据为静态快照而非实时。"
        "遇到个案事务（enrollment hold、petition、prereq waiver、成绩申诉等），"
        "说明这类事务需要通过官方渠道处理（Virtual Advising Center、院系 advisor 或 WebReg 支持），"
        "并且仅在这种实际转介的回复末尾单独一行输出标记 [转介]（英文回复用 [Referral]）；"
        "介绍自身能力边界时不要输出该标记。"
    )


class CourseAgent(BaseAgent):
    agent_type    = AgentType.COURSE
    system_prompt = (
        "你是 CourseHub 的课程事实专家，回答 UCSD 课程的客观信息："
        "课程内容、学分、先修与限制、上课时间地点、名额、授课教授、成绩历史。"
        "严格基于提供的检索结果和结构化数据回答；精确数字（名额、时间、GPA）"
        "只能引用数据，绝不猜测或编造。名额/座位数字必须注明数据快照时间并说明非实时。"
        "成绩历史按 教授 × 学期 逐条列出，不要合成单一课程 GPA。"
        "课程没有官方描述就明说没有；数据未覆盖就如实说明。回答中标注所指学期。"
        "用用户使用的语言（中文或英文）回答。"
    )


class PlanningAgent(BaseAgent):
    agent_type    = AgentType.PLANNING
    system_prompt = (
        "你是 CourseHub 的选课规划顾问，基于课程数据给出有依据的倾向性建议："
        "修课顺序、课程组合负担、教授/section 选择。"
        "每条建议必须引用依据（先修链、时间安排、成绩历史记录等）；"
        "成绩数据仅覆盖有限的快照范围，不要外推为长期规律。"
        "每次回答末尾附一行免责声明：本建议为非官方参考，选课决策请咨询学校学业顾问。"
        "（英文回答时用：Unofficial suggestion — please confirm with your academic counselor.）"
        "遇到个案事务时说明需要通过官方渠道处理，并仅在这种实际转介的回复末尾"
        "单独一行输出标记 [转介]（英文回复用 [Referral]）。用用户使用的语言回答。"
    )


# ── 领域路由表（_domain_scores 的单一词表来源）────────────────────────────────

_COURSE_INTENTS = {
    IntentCategory.FACTS,
    IntentCategory.COURSE_OVERVIEW,
    IntentCategory.PREREQUISITES,
    IntentCategory.SCHEDULE,
    IntentCategory.AVAILABILITY,
    IntentCategory.INSTRUCTOR_LOOKUP,
    IntentCategory.GRADES_HISTORY,
    IntentCategory.COURSE_SEARCH,
}
_PLANNING_INTENTS = {
    IntentCategory.PLANNING,
    IntentCategory.PLAN_SEQUENCE,
    IntentCategory.WORKLOAD_ADVICE,
    IntentCategory.PROFESSOR_CHOICE,
}
_GENERAL_INTENTS = {
    IntentCategory.GENERAL,
    IntentCategory.GREETING,
    IntentCategory.META_INFO,
    IntentCategory.OTHER,
}

_DOMAIN_KEYWORDS: Dict[AgentType, List[str]] = {
    AgentType.COURSE: [
        "先修", "prerequisite", "prereq", "学分", "units", "名额", "位置", "seat",
        "waitlist", "教授", "professor", "instructor", "gpa", "成绩", "给分", "grade",
        "上课时间", "教室", "schedule", "开课", "什么时候上",
    ],
    AgentType.PLANNING: [
        "建议", "推荐", "规划", "该不该", "怎么选", "选哪个", "顺序", "负担", "太累",
        "先上", "一起上", "should i", "workload", "plan my", "which professor", "take first",
    ],
    AgentType.GENERAL: [
        "你好", "hello", "数据来源", "能做什么", "能回答", "帮助", "help", "thanks", "谢谢",
    ],
}


# ── 编排器 ────────────────────────────────────────────────────────────────────

class AgentOrchestrator:
    """
    多 Agent 编排器。

    路由逻辑（三层）：
      1. 领域打分（_route_decision / _domain_scores）选出主/辅 Agent
      2. 同类多实例时按 routing_score() 选最优
      3. 专属 Agent 失败时降级到 GeneralAgent
    """

    def __init__(
        self,
        api_key:  str,
        base_url: Optional[str] = None,
        model:    str = "claude-3-5-sonnet-20241022",
        skill_manager: Optional[Any] = None,
    ):
        kwargs: Dict[str, Any] = {"api_key": api_key}
        if base_url:
            kwargs["base_url"] = base_url
        client = AsyncAnthropic(**kwargs)

        self._intent_recognizer = IntentRecognizer(api_key=api_key, base_url=base_url, model=model)
        self._skill_manager = skill_manager

        # Agent 池：每种类型可有多个实例（水平扩展）
        self._pool: Dict[AgentType, List[BaseAgent]] = {
            AgentType.GENERAL:  [GeneralAgent(client, model, skill_manager)],
            AgentType.COURSE:   [CourseAgent(client, model, skill_manager)],
            AgentType.PLANNING: [PlanningAgent(client, model, skill_manager)],
        }

    def set_skill_manager(self, skill_manager: Optional[Any]) -> None:
        """更新 SkillManager 引用，供运行时重载或测试替换使用。"""
        self._skill_manager = skill_manager
        for agents in self._pool.values():
            for agent in agents:
                agent._skill_manager = skill_manager

    async def recognize_intent(
        self,
        message: str,
        history: Optional[List[Dict[str, str]]] = None,
    ):
        """对外暴露意图识别，供 API 层先判断是否需要 RAG 等前置能力。"""
        return await self._intent_recognizer.recognize(message, history=history)

    # ── 主入口 ────────────────────────────────────────────────────────────────

    async def run(self, req: Request) -> OrchestratorResult:
        """
        处理一次请求的完整流程：
          意图识别 → 路由选 Agent → 执行 → 检查升级 → 返回结果
        """
        t0 = time.monotonic()

        # 1. 意图识别（如果调用方已识别则跳过）
        if req.intent is None:
            intent_result = await self._intent_recognizer.recognize(req.message, history=req.history)
            req.intent  = intent_result.intent
            req.intent_group = intent_result.intent_group
            req.urgency = intent_result.urgency
            req.intent_confidence = intent_result.confidence
            if not req.entities:
                req.entities = intent_result.entities  # 实体驱动领域加成与 [结构化实体] 注入

        if self._needs_clarification(req):
            return OrchestratorResult(
                request_id=req.request_id,
                response=self._clarification_message(req.message),
                agent_type=AgentType.GENERAL,
                intent=req.intent,
                escalated=False,
                latency_ms=(time.monotonic() - t0) * 1000,
                agent_types=[AgentType.GENERAL],
                primary_agent=AgentType.GENERAL,
                routing_reason="低置信度 OTHER 意图，先澄清用户需求",
                routing_confidence=req.intent_confidence,
            )

        # 复杂问题自动并行协作，例如同一句同时涉及课程事实与选课规划。
        decision = self._route_decision(req)
        await emit_stage("routing_decided", {
            "primary_agent": decision.primary_agent.value,
            "supporting_agents": [a.value for a in decision.supporting_agents],
            "routing_reason": decision.reason,
            "routing_confidence": decision.confidence,
        })
        if decision.multi_agent:
            return await self.run_parallel(req, decision)

        # 2. 执行主 Agent（含降级）
        response = await self._execute(req, decision.primary_agent)

        # 4. 升级检查
        escalated = False
        if response.escalate or req.urgency == UrgencyLevel.CRITICAL or req.intent in (
            IntentCategory.ESCALATION,
            IntentCategory.ADVISOR_REFERRAL,
        ):
            escalated = True
            logger.warning(f"请求 {req.request_id} 触发转介: urgency={req.urgency}")
            # escalated=true 语义：已转介官方渠道（VAC / 院系 advisor / WebReg 支持）

        return OrchestratorResult(
            request_id=req.request_id,
            response=response.content,
            agent_type=response.agent_type,
            intent=req.intent,
            escalated=escalated,
            latency_ms=(time.monotonic() - t0) * 1000,
            agent_types=[response.agent_type],
            primary_agent=decision.primary_agent,
            supporting_agents=[],
            routing_reason=decision.reason,
            routing_confidence=decision.confidence,
        )

    async def run_parallel(self, req: Request, decision: RoutingDecision) -> OrchestratorResult:
        """
        并行派发给多个 Agent，合并结果。
        适用于复杂问题（如同时涉及课程事实和选课规划）。
        """
        t0 = time.monotonic()
        agent_types = decision.agent_types
        tasks = [self._execute(req, at) for at in agent_types]
        responses = await asyncio.gather(*tasks, return_exceptions=True)

        # 合并：主 Agent 在前，辅助 Agent 在后。
        parts = []
        for r in responses:
            if isinstance(r, AgentResponse) and r.success:
                role = "主处理" if r.agent_type == decision.primary_agent else "辅助处理"
                parts.append(f"[{r.agent_type.value} - {role}]\n{r.content}")

        combined = "\n\n".join(parts) if parts else "抱歉，所有 Agent 均处理失败。"
        escalated = any(isinstance(r, AgentResponse) and r.escalate for r in responses)

        return OrchestratorResult(
            request_id=req.request_id,
            response=combined,
            agent_type=decision.primary_agent,
            intent=req.intent,
            escalated=escalated,
            latency_ms=(time.monotonic() - t0) * 1000,
            agent_types=[
                r.agent_type for r in responses
                if isinstance(r, AgentResponse) and r.success
            ] or agent_types,
            primary_agent=decision.primary_agent,
            supporting_agents=decision.supporting_agents,
            routing_reason=decision.reason,
            routing_confidence=decision.confidence,
        )

    # ── 路由逻辑 ──────────────────────────────────────────────────────────────

    def _route_decision(self, req: Request) -> RoutingDecision:
        """
        结构化路由决策。

        先处理紧急/转人工，再用领域分数决定主 Agent 和辅助 Agent。
        这样可以表达“主处理 + 辅助诊断”，避免关键词命中后无主次地拼接。
        """
        if req.urgency == UrgencyLevel.CRITICAL:
            return RoutingDecision(
                primary_agent=AgentType.GENERAL,
                reason="紧急度为 CRITICAL，触发升级路由",
                confidence=1.0,
            )

        if req.intent in (IntentCategory.ESCALATION, IntentCategory.ADVISOR_REFERRAL):
            return RoutingDecision(
                primary_agent=AgentType.GENERAL,
                reason=f"意图为 {req.intent.value if req.intent else 'unknown'}，触发转介路由",
                confidence=max(req.intent_confidence, 0.8),
            )

        scores = self._domain_scores(req)
        available_scores = {
            agent_type: score
            for agent_type, score in scores.items()
            if agent_type == AgentType.GENERAL or self._pool.get(agent_type)
        }
        if not available_scores:
            return RoutingDecision(
                primary_agent=AgentType.GENERAL,
                reason="无可用专属 Agent，降级到 GeneralAgent",
                confidence=0.1,
            )

        ordered = sorted(available_scores.items(), key=lambda item: item[1], reverse=True)
        primary_agent, primary_score = ordered[0]
        supporting_agents = [
            agent_type
            for agent_type, score in ordered[1:]
            if agent_type != AgentType.GENERAL and score >= 0.45 and score >= primary_score * 0.55
        ]

        reason = self._routing_reason(req, available_scores, primary_agent, supporting_agents)
        return RoutingDecision(
            primary_agent=primary_agent,
            supporting_agents=supporting_agents,
            reason=reason,
            confidence=round(min(primary_score, 1.0), 3),
        )

    def _domain_scores(self, req: Request) -> Dict[AgentType, float]:
        """按意图、关键词和实体为各领域 Agent 打分（词表与协作检测共用单一来源）。"""
        msg = req.message.lower()
        scores = {
            AgentType.GENERAL: 0.1,
            AgentType.COURSE: 0.0,
            AgentType.PLANNING: 0.0,
        }

        if req.intent in _GENERAL_INTENTS:
            scores[AgentType.GENERAL] += 0.55
        if req.intent in _COURSE_INTENTS:
            scores[AgentType.COURSE] += 0.75
        if req.intent in _PLANNING_INTENTS:
            scores[AgentType.PLANNING] += 0.75

        course_hits = sum(1 for kw in _DOMAIN_KEYWORDS[AgentType.COURSE] if kw in msg)
        planning_hits = sum(1 for kw in _DOMAIN_KEYWORDS[AgentType.PLANNING] if kw in msg)
        general_hits = sum(1 for kw in _DOMAIN_KEYWORDS[AgentType.GENERAL] if kw in msg)

        scores[AgentType.COURSE] += min(0.45, course_hits * 0.18)
        scores[AgentType.PLANNING] += min(0.45, planning_hits * 0.18)
        scores[AgentType.GENERAL] += min(0.35, general_hits * 0.12)

        entities = req.entities or {}
        if entities.get("course_code"):
            scores[AgentType.COURSE] += 0.2
        if entities.get("instructor"):
            scores[AgentType.COURSE] += 0.15
        if entities.get("term"):
            scores[AgentType.COURSE] += 0.1
        # 同一句提到多门课通常意味着比较/组合，是规划信号
        if len(entities.get("course_code", [])) >= 2:
            scores[AgentType.PLANNING] += 0.15

        return {agent_type: round(score, 3) for agent_type, score in scores.items()}

    @staticmethod
    def _routing_reason(
        req: Request,
        scores: Dict[AgentType, float],
        primary_agent: AgentType,
        supporting_agents: List[AgentType],
    ) -> str:
        score_text = ", ".join(
            f"{agent_type.value}={score:.2f}"
            for agent_type, score in sorted(scores.items(), key=lambda item: item[1], reverse=True)
        )
        support_text = ", ".join(agent.value for agent in supporting_agents) or "none"
        intent = req.intent.value if req.intent else "unknown"
        return (
            f"intent={intent}, group={req.intent_group or 'unknown'}, "
            f"primary={primary_agent.value}, supporting={support_text}, scores=[{score_text}]"
        )

    @staticmethod
    def _needs_clarification(req: Request) -> bool:
        """低置信度且无明确意图时，先追问，避免误路由。"""
        if req.intent != IntentCategory.OTHER:
            return False
        text = (req.message or "").strip()
        if len(text) <= 2:
            return False
        return req.intent_confidence < 0.5

    @staticmethod
    def _clarification_message(message: str) -> str:
        if re.search(r"[\u3400-\u9fff]", message or ""):
            return (
                "我还不能确定您想了解哪类信息。请补充一下是课程内容、上课时间/名额、"
                "成绩历史，还是选课规划建议？"
            )
        return (
            "I’m not yet sure what you’d like to know. Could you clarify whether you mean "
            "course content, schedule or seats, grade history, or course planning?"
        )

    def _best_agent(self, agent_type: AgentType) -> Optional[BaseAgent]:
        """
        性能路由：从同类 Agent 中选 routing_score() 最高的。
        这是"基于在线表现动态调整路由"的核心。
        """
        agents = self._pool.get(agent_type, [])
        if not agents:
            return None
        return max(agents, key=lambda a: a.stats.routing_score())

    async def _execute(self, req: Request, agent_type: AgentType) -> AgentResponse:
        """执行 Agent，失败时降级到 GeneralAgent。"""
        agent = self._best_agent(agent_type)
        if agent is None:
            agent = self._best_agent(AgentType.GENERAL)
        if agent is None:
            return AgentResponse(
                agent_type=AgentType.GENERAL,
                content="服务暂时不可用，请稍后重试。",
                success=False,
            )

        response = await agent.handle(req)

        # 专属 Agent 失败时降级到 GeneralAgent
        if not response.success and agent_type != AgentType.GENERAL:
            logger.warning(f"{agent_type.value} 失败，降级到 GeneralAgent")
            fallback = self._best_agent(AgentType.GENERAL)
            if fallback:
                response = await fallback.handle(req)

        return response

    # ── 统计（供 Monitor 读取）────────────────────────────────────────────────

    def get_stats(self) -> Dict[str, Any]:
        result = {}
        for agent_type, agents in self._pool.items():
            for i, agent in enumerate(agents):
                key = f"{agent_type.value}_{i}"
                result[key] = {
                    "total":        agent.stats.total,
                    "success_rate": round(agent.stats.success_rate, 3),
                    "avg_ms":       round(agent.stats.avg_ms, 1),
                    "monitor_penalty": round(agent.stats.monitor_penalty, 3),
                    "routing_score": round(agent.stats.routing_score(), 3),
                }
        return result

    def update_routing_penalties(self, penalties: Dict[str, float]) -> None:
        """
        接收 Monitor 的在线表现反馈，动态调整路由惩罚项。

        penalties 的 key 使用 get_stats() 中的 agent key，例如 course_0。
        """
        for agent_type, agents in self._pool.items():
            for i, agent in enumerate(agents):
                key = f"{agent_type.value}_{i}"
                penalty = penalties.get(key, 0.0)
                agent.stats.monitor_penalty = min(max(penalty, 0.0), 0.9)
