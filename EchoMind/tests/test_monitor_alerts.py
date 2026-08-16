"""告警去重与消解:同一指标持续超标只占一条,恢复后自动消解。

采集每 interval_s 跑一次,持续超标的指标会被反复触发。若每次都追加一条
新告警,summary() 的 [-10:] 窗口很快被同一条刷满,真正不同的新告警反而被
挤出去——重复不只是噪音,它会淹掉信号。
"""
import pytest

pytest.importorskip("httpx")

from monitor.performance_monitor import PerformanceMonitor


@pytest.fixture()
def monitor():
    return PerformanceMonitor(orchestrator=object(), tool_manager=object())


def active(monitor):
    return monitor.summary_alerts() if hasattr(monitor, "summary_alerts") else [
        a for a in monitor._alerts if not a.resolved
    ]


def test_repeated_breach_updates_one_alert_instead_of_piling_up(monitor):
    for value in (7379.6, 7400.0, 7500.0):
        monitor._check_threshold("agent_avg_ms", value, "course_0")

    alerts = active(monitor)
    assert len(alerts) == 1
    assert alerts[0].metric == "agent_avg_ms:course_0"
    # 最近一次的值,不是第一次的
    assert alerts[0].value == 7500.0
    assert alerts[0].count == 3


def test_distinct_labels_stay_separate(monitor):
    monitor._check_threshold("agent_avg_ms", 7379.6, "course_0")
    monitor._check_threshold("agent_avg_ms", 16578.2, "planning_0")
    monitor._check_threshold("agent_avg_ms", 7400.0, "course_0")

    alerts = active(monitor)
    assert {a.metric for a in alerts} == {
        "agent_avg_ms:course_0",
        "agent_avg_ms:planning_0",
    }
    assert {a.count for a in alerts} == {2, 1}


def test_recovery_resolves_the_alert(monitor):
    monitor._check_threshold("agent_avg_ms", 7379.6, "course_0")
    assert len(active(monitor)) == 1

    # 回到阈值内:告警自动消解,不再永久挂着
    monitor._check_threshold("agent_avg_ms", 1200.0, "course_0")
    assert active(monitor) == []

    # 再次超标:重新成为活跃告警,计数从头开始
    monitor._check_threshold("agent_avg_ms", 9000.0, "course_0")
    alerts = active(monitor)
    assert len(alerts) == 1
    assert alerts[0].count == 1


def test_repeats_no_longer_push_other_alerts_out_of_the_summary_window(monitor):
    # 一个吵闹的指标重复 30 次
    for _ in range(30):
        monitor._check_threshold("agent_avg_ms", 7379.6, "course_0")
    # 之后出现的另一个告警必须仍然可见
    monitor._check_threshold("tool_avg_ms", 9000.0, "knowledge_search")

    metrics = {a.metric for a in active(monitor)}
    assert "tool_avg_ms:knowledge_search" in metrics
    assert metrics == {"agent_avg_ms:course_0", "tool_avg_ms:knowledge_search"}


def test_unknown_metric_is_ignored(monitor):
    monitor._check_threshold("not_a_threshold", 999.0, "x")
    assert active(monitor) == []


def test_summary_truncation_keeps_errors_over_warnings(monitor):
    # 12 条 warning 先到,一条 error 最后到:窗口只有 10 个位置
    for i in range(12):
        monitor._check_threshold("tool_success_rate", 0.5, f"tool_{i}")
    monitor._check_threshold("agent_success_rate", 0.1, "course_0")

    monitor._orchestrator = type("O", (), {"get_stats": lambda self: {}})()
    monitor._tool_manager = type("T", (), {"get_stats": lambda self: {}})()
    shown = monitor.summary()["active_alerts"]

    assert len(shown) == 10
    assert shown[0]["metric"] == "agent_success_rate:course_0"
    # asdict 保留枚举实例;序列化成字符串是 FastAPI 编码器的事。
    assert shown[0]["severity"].value == "error"
