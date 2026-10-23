
from dataclasses import dataclass, asdict
from typing import Optional


@dataclass
class Detection:
    type: str
    source: str
    confidence: float
    bbox: Optional[list[float]] = None
    text: Optional[str] = None
    text_span: Optional[dict[str, int]] = None 
    context_id: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)
