from ..db import Database
from ..models import Order, Item
from .pricing import apply_discount


class OrderService:
    """Создание и поиск заказов."""

    def __init__(self, repo: Database):
        self.repo = repo

    def _validate(self, order):
        if not order.items:
            raise ValueError("пустой заказ")

    def create(self, customer, lines, code=None):
        order = Order(customer=customer, items=[Item(**l) for l in lines])
        self._validate(order)
        amount = apply_discount(order.total(), code)
        with self.repo.transaction():
            order_id = self.repo.insert({"customer": customer, "amount": amount})
        return order_id, amount

    def find(self, customer):
        return self.repo.query(customer)
