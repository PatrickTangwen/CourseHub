import asyncio
import json
import sys
import types
from datetime import datetime


sys.modules.setdefault("chromadb", types.ModuleType("chromadb"))
redis_package = types.ModuleType("redis")
redis_package.__path__ = []
redis_async = types.ModuleType("redis.asyncio")
redis_package.asyncio = redis_async
sys.modules.setdefault("redis", redis_package)
sys.modules.setdefault("redis.asyncio", redis_async)

from memory.conversation_memory import MemoryManager, MsgRole  # noqa: E402


class FakeRedis:
    def __init__(self, messages):
        self.messages = messages
        self.lrange_calls = []
        self.mutations = []

    async def lrange(self, key, start, end):
        self.lrange_calls.append((key, start, end))
        return self.messages

    async def get(self, key):
        return "existing summary"

    async def setex(self, *args):
        self.mutations.append(("setex", args))

    async def delete(self, *args):
        self.mutations.append(("delete", args))

    async def lpush(self, *args):
        self.mutations.append(("lpush", args))

    async def expire(self, *args):
        self.mutations.append(("expire", args))


class FailingMessages:
    async def create(self, **kwargs):
        raise RuntimeError("summary service unavailable")


def test_failed_summary_keeps_all_working_memory_for_retry():
    serialized = [
        json.dumps({
            "role": MsgRole.USER.value,
            "content": f"message {index}",
            "ts": datetime.now().isoformat(),
            "metadata": {},
        })
        for index in reversed(range(18))
    ]
    manager = MemoryManager.__new__(MemoryManager)
    manager._redis = FakeRedis(serialized)
    manager._client = types.SimpleNamespace(messages=FailingMessages())
    manager._model = "test-model"

    asyncio.run(manager._compress("user", "conversation"))

    assert manager._redis.lrange_calls == [("wm:user:conversation", 0, -1)]
    assert manager._redis.mutations == []
