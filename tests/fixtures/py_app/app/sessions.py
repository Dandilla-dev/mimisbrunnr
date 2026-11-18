"""Сессии покупателей: что лежит в корзине между запросами."""


class Session:
    def __init__(self, customer):
        self.customer = customer
        self.lines = []

    def add(self, line):
        self.lines.append(line)


class SessionStore:
    def __init__(self):
        self.by_customer = {}

    def get(self, customer) -> "Session":
        if customer not in self.by_customer:
            self.by_customer[customer] = Session(customer)
        return self.by_customer[customer]


memory = SessionStore()


def remember_line(customer, line):
    session = memory.get(customer)
    session.add(line)
    return len(session.lines)
