"""Скидки и цены."""

DISCOUNTS = {"WELCOME": 0.1, "VIP": 0.2}


def _rate(code):
    return DISCOUNTS.get(code, 0.0)


def apply_discount(amount, code=None):
    """Возвращает сумму со скидкой по промокоду."""
    return round(amount * (1 - _rate(code)), 2)
