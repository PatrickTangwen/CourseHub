"""pytest 配置：把 EchoMind 根目录加入 sys.path，使 `coursedata` 可导入。

注意：测试只依赖 stdlib + coursedata，不导入 mcp/core/api（它们需要 anthropic 等依赖）。
"""
import pathlib
import sys

_ECHOMIND_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(_ECHOMIND_ROOT) not in sys.path:
    sys.path.insert(0, str(_ECHOMIND_ROOT))
