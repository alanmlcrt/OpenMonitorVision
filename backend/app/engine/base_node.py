from abc import ABC, abstractmethod
from typing import Any


class BaseNode(ABC):
    type: str = "base"

    def validate_config(self, config: dict) -> None:
        pass

    @abstractmethod
    async def run(self, context: Any, input_data: dict) -> dict:
        pass
