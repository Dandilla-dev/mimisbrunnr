"""Работа с базой данных (упрощённо, в памяти)."""
from contextlib import contextmanager


class Database:
    """Хранилище строк в памяти."""

    def __init__(self):
        self.rows = []
        self.connected = False

    def connect(self):
        self.connected = True
        return self

    def query(self, sql, *params):
        if not self.connected:
            self.connect()
        return [r for r in self.rows if sql in str(r)]

    def insert(self, row):
        self.rows.append(row)
        return len(self.rows)

    @contextmanager
    def transaction(self):
        snapshot = list(self.rows)
        try:
            yield self
        except Exception:
            self.rows = snapshot
            raise


db = Database()


def get_db():
    return db.connect()
