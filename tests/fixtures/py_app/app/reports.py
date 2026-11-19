"""Отчёты: наследование, выбор метода по строке и функции в словаре."""


class BaseExporter:
    def header(self):
        return "report"

    def export(self, rows):
        return self.header() + str(rows)


class CsvExporter(BaseExporter):
    def export_csv(self, rows):
        return ",".join(rows)

    def export_pdf(self, rows):
        return self.export(rows)


def make_report(fmt, rows):
    exp = CsvExporter()
    exp.header()
    return getattr(exp, "export_" + fmt)(rows)


def to_upper(text):
    return text.upper()


def to_lower(text):
    return text.lower()


TRANSFORMS = {"up": to_upper, "low": to_lower}


def transform(kind, text):
    return TRANSFORMS[kind](text)


class Mailer:
    def deliver_welcome(self, to):
        return f"welcome, {to}"


def notify(mailer, user):
    return mailer.deliver_welcome(user)
