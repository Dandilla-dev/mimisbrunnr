from dataclasses import dataclass, field


@dataclass
class Item:
    name: str
    price: float
    qty: int = 1

    def subtotal(self):
        return self.price * self.qty


@dataclass
class Order:
    customer: str
    items: list = field(default_factory=list)

    def total(self):
        return sum(i.subtotal() for i in self.items)
