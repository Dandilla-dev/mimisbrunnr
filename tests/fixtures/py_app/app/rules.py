"""Правила проверки заказа на мошенничество."""


def _rule_big_amount(order):
    return order.get("amount", 0) > 10000


def _rule_new_customer(order):
    return order.get("orders_before", 0) == 0


def _rule_night_time(order):
    return order.get("hour", 12) < 6


def classify(order):
    """Возвращает 'block', 'review' или 'ok'."""
    strong = _rule_big_amount(order)
    weak = [r(order) for r in (_rule_new_customer, _rule_night_time)]
    if strong:
        level = "block"
    elif sum(weak) >= 2:
        level = "review"
    else:
        level = "ok"
    return level
