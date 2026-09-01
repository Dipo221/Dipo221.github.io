# -*- coding: utf-8 -*-
"""
純函式：解析 MLB Stats API 的異動描述文字，算出最快可回歸日。

這支不碰網路、不碰檔案，所以 test_parse.py 可以直接對它下真實字串測。
會需要解析自由文字是因為 API 把傷勢部位、IL 天數、retroactive 起算日
全部塞在 description 這一句英文裡，沒有拆成欄位：

    Minnesota Twins placed CF Byron Buxton on the 10-day injured list
      retroactive to August 27, 2026. Right hip impingement.

球員身分一律用 person.id 對，不要用名字對——
名字有 Jr.、重音字（Ronald Acuña Jr.）跟同名同姓，用名字遲早會配錯人。
"""

import re
from datetime import date, timedelta

MONTHS = {
    "January": 1, "February": 2, "March": 3, "April": 4,
    "May": 5, "June": 6, "July": 7, "August": 8,
    "September": 9, "October": 10, "November": 11, "December": 12,
}

# 「10-day injured list」「60-day injured list」，也吃沒有天數的 paternity/bereavement/restricted list
_LIST_RE = re.compile(
    r"(?:the\s+)?(?:(?P<days>\d+)-day\s+)?(?P<kind>injured|paternity|bereavement|restricted)\s+list",
    re.IGNORECASE,
)

# 「retroactive to August 27, 2026」
_RETRO_RE = re.compile(
    r"retroactive to\s+(?P<month>[A-Z][a-z]+)\s+(?P<day>\d{1,2}),\s*(?P<year>\d{4})"
)

# 動詞決定這筆是進去還是出來。transferred 要排在 placed 前面判斷，
# 因為 transferred 的句子裡同時有 from 跟 to 兩個 list。
_ACTION_RE = re.compile(
    r"\b(?P<verb>placed|activated|transferred|reinstated|sent|recalled|selected|optioned)\b",
    re.IGNORECASE,
)

# 描述句尾的傷勢。API 大約 15~20% 的 IL 異動沒有這一句。
# 抓「第一個 list 之後、句號結束的最後一段」，並排除 retroactive 那一句。
_INJURY_RE = re.compile(r"list(?:\s+retroactive to [^.]*)?\.\s*(?P<injury>.+?)\s*$")


def parse_date(text):
    """把 'August 27, 2026' 轉成 date。認不得就回 None，不要丟例外。"""
    if not text:
        return None
    m = _RETRO_RE.search(text) or re.match(
        r"\s*(?P<month>[A-Z][a-z]+)\s+(?P<day>\d{1,2}),\s*(?P<year>\d{4})\s*$", text
    )
    if not m:
        return None
    month = MONTHS.get(m.group("month"))
    if not month:
        return None
    try:
        return date(int(m.group("year")), month, int(m.group("day")))
    except ValueError:
        return None


def parse_iso(text):
    """'2026-08-30' -> date。API 的 date/effectiveDate 都是這個格式。"""
    if not text:
        return None
    try:
        y, m, d = str(text).split("-")
        return date(int(y), int(m), int(d))
    except (ValueError, AttributeError):
        return None


def parse_move(description, tx_date=None):
    """
    解析一筆異動描述。

    回傳 dict；不是傷兵/名單相關的（交易、釋出等）回 None，讓呼叫端跳過。

    keys:
      action      placed / activated / transferred / other
      list_kind   injured / paternity / bereavement / restricted
      days        10 / 15 / 60，paternity 這類沒天數的是 None
      retro_date  date 或 None
      start_date  這段期間的起算日 = retro_date or tx_date
      injury      傷勢文字，沒有就 None
    """
    if not description:
        return None

    lm = _LIST_RE.search(description)
    if not lm:
        return None

    am = _ACTION_RE.search(description)
    verb = (am.group("verb").lower() if am else "other")
    if verb in ("reinstated",):
        verb = "activated"
    if verb not in ("placed", "activated", "transferred"):
        # 「sent X on a rehab assignment」這種句子裡也有 injured list 字樣，
        # 但它不是進出名單的異動，不要當成 IL 事件。
        return None

    days = int(lm.group("days")) if lm.group("days") else None

    # transferred 是 10-day 轉 60-day，要抓「to」後面那個天數才是新的期限
    if verb == "transferred":
        tos = re.search(r"to the\s+(\d+)-day\s+injured list", description, re.IGNORECASE)
        if tos:
            days = int(tos.group(1))

    retro = parse_date(description)
    start = retro or parse_iso(tx_date) if tx_date else retro

    injury = None
    im = _INJURY_RE.search(description)
    if im:
        candidate = im.group("injury").strip()
        # 只留看起來像傷勢描述的短句；太長的通常是後面又接了別的句子
        if candidate and len(candidate) <= 120:
            injury = candidate.rstrip(".").strip() or None

    return {
        "action": verb,
        "list_kind": lm.group("kind").lower(),
        "days": days,
        "retro_date": retro,
        "start_date": start,
        "injury": injury,
    }


def earliest_return(start_date, days):
    """
    最快可回歸日 = 起算日 + IL 天數。

    這是規則算出來的「最早有資格被啟動」的日期，不是預估回歸日——
    API 沒有預估回歸這種資料，介面上也要照這個語意標，不要寫成「預計回歸」。
    """
    if not start_date or not days:
        return None
    return start_date + timedelta(days=days)


def days_until(target, today):
    """還有幾天。已經過了回負數，呼叫端用來標「已可回歸」。"""
    if not target or not today:
        return None
    return (target - today).days


def is_hard_hit(launch_speed, threshold=95.0):
    """
    強擊球判定：初速 >= 95 mph，這是業界通用的 hard-hit 門檻。

    刻意不叫 barrel——barrel 是初速與仰角的特定組合，
    我們只看初速，名字就要照實叫，不要借官方術語。
    """
    if launch_speed is None:
        return False
    try:
        return float(launch_speed) >= threshold
    except (TypeError, ValueError):
        return False
