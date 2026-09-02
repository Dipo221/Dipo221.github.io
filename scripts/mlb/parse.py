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

    只看初速，所以高初速的滾地球也算——要區分「打得紮實」和「打得好」
    得看仰角，那是 is_barrel() 的事。
    """
    if launch_speed is None:
        return False
    try:
        return float(launch_speed) >= threshold
    except (TypeError, ValueError):
        return False


def is_barrel(launch_speed, launch_angle):
    """
    Barrel 判定：初速 >= 98 mph，且仰角落在隨初速放寬的區間內。

    98 mph 時只有 26~30 度算，初速愈快區間愈寬，到 116 mph 放寬成 8~50 度——
    球夠猛的話角度差一點還是會變成長打。

    Statcast 官方公布的是兩個端點，中間那張逐 mph 的表沒有完整公開，
    所以這裡在兩個端點之間做線性內插：

        下限 = 124 - EV        （98→26、116→8，斜率剛好 -1）
        上限 = 30 + (EV-98)*10/9（98→30、116→50）

    兩端各自夾住不再外擴，不然 120 mph 會算出 4~54 度這種不存在的區間。

    兩個端點是精確的，中間幾度會比官方略嚴——寧可少算幾顆，
    也不要為了湊數去編一張自己記不清楚的對照表。畫面上要說明這是算出來的。

    仰角缺值一律不算。實測 312 顆有初速的球全都有仰角，但寧可漏算也不要猜。
    """
    if launch_speed is None or launch_angle is None:
        return False
    try:
        speed = float(launch_speed)
        angle = float(launch_angle)
    except (TypeError, ValueError):
        return False
    if speed < 98.0:
        return False
    lower = max(8.0, 124.0 - speed)
    upper = min(50.0, 30.0 + (speed - 98.0) * 10.0 / 9.0)
    return lower <= angle <= upper


"""
新聞主題分類用的關鍵字。

只看標題，所以一定會誤判——「其他」是誠實的出口，不要為了讓每篇都有標籤
硬把關鍵字擴到會亂咬的程度。

順序有意義，先中先得：
  傷兵排在異動前面，因為傷兵新聞常常寫 "placed on the IL"，兩邊都會中，
  但使用者想在傷兵那類看到它。
  異動排在分析前面，因為 "Prospect called up" 是事實不是分析。

短字一律用左右詞邊界（\bil\b、\btear\b），不然 "until"、"years" 都會中。
"sign" 只鎖左邊界，才能吃 signs/signed/signing 又不會咬到 "assign"。
"""
_NEWS_RULES = [
    ("injury", re.compile(
        r"\binjur|\bil\b|\bplaced on\b|\bday-to-day\b|\bstrain|\bsprain"
        r"|\bsurgery\b|\bmri\b|\bfracture|\btear\b|\btorn\b|\bsidelined\b"
        r"|\bsetback\b|\brehab|\bconcussion|\bhamstring\b|\boblique\b"
        r"|\bsore|\bdiscomfort|\btommy john\b|\bout for\b",
        re.IGNORECASE)),
    # "waived" 要鎖死尾巴，不能寫成 \bwaive——不然 "Waiver Wire Rankings"
    # 這種純粹是 fantasy 分析的標題會被當成球員被 DFA。
    # 「claimed off waivers」照樣抓得到，因為 claim 本來就在清單裡。
    #
    # select 只收動詞形（select/selects/selected/selecting），不收 selection——
    # 「選上合約」的標題一律是 "Pirates Select X"，
    # 而 "All-Star selections"、"draft selections" 講的是入選跟選秀，不是這一類。
    #
    # call up 要吃連字號跟 -ing：實際看到的寫法有 called up、calling up、
    # call-up、call-ups 四種，只寫 \bcall(?:ed)?\s+up\b 會漏掉一半。
    ("move", re.compile(
        r"\bsign|\btrade|\bdeal|\bacquire|\bclaim|\bwaived\b|\bdfa\b"
        r"|\bdesignate|\boption|\brecall|\bpromot|\bselect(?:s|ed|ing)?\b"
        r"|\bcall(?:ed|ing)?[\s-]+ups?\b|\bextension\b|\brelease|\bnon-tender",
        re.IGNORECASE)),
    ("analysis", re.compile(
        r"\brankings?\b|\bwaiver|\bstart/sit\b|\bsleeper|\bfantasy\b"
        r"|\bprojection|\bprospect|\bpreview\b|\bbreakout\b|\bbuy low\b"
        r"|\bsell high\b|\bstreamer|\bdraft\b",
        re.IGNORECASE)),
]


def categorize(title):
    """
    用標題把新聞分成 injury / move / analysis / other 四類。

    分不出來就回 other，不要硬塞進最像的那一類——
    一個誠實的「其他」比一個亂猜的標籤有用。
    """
    if not title:
        return "other"
    text = str(title)
    for name, pattern in _NEWS_RULES:
        if pattern.search(text):
            return name
    return "other"
