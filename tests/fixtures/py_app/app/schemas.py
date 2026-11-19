"""Схемы запросов: FastAPI проверяет по ним тело запроса."""
from pydantic import BaseModel, Field


class LineIn(BaseModel):
    name: str
    price: float = Field(gt=0)
    qty: int = 1


class OrderIn(BaseModel):
    customer: str = Field(min_length=1)
    lines: list[LineIn]
    code: str | None = None
