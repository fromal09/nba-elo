"""Holiday games for holiday cards: a card from a game played on one of these dates is a holiday card.

  hal   Halloween          Oct. 31
  thx   Thanksgiving       the fourth Thursday of November
  xmas  Christmas          Dec. 25
  mlk   MLK Day            the third Monday of January, since 1986
  val   Valentine's Day    Feb. 14

The site (src/components/holidays.js) and the store (api/_lib/holidays.js) use the same dates.
"""
from datetime import date, timedelta

NAMES = {"hal": "Halloween", "thx": "Thanksgiving", "xmas": "Christmas", "mlk": "MLK Day", "val": "Valentine's Day"}


def _nth_weekday(y, m, weekday, n):
    d = date(y, m, 1)
    d += timedelta((weekday - d.weekday()) % 7)
    return d + timedelta(weeks=n - 1)


def holiday_of(day):
    """The holiday key for a game date ('YYYY-MM-DD'), or None."""
    d = date.fromisoformat(day[:10])
    if (d.month, d.day) == (10, 31):
        return "hal"
    if (d.month, d.day) == (12, 25):
        return "xmas"
    if (d.month, d.day) == (2, 14):
        return "val"
    if d.month == 11 and d == _nth_weekday(d.year, 11, 3, 4):
        return "thx"
    if d.month == 1 and d.year >= 1986 and d == _nth_weekday(d.year, 1, 0, 3):
        return "mlk"
    return None
