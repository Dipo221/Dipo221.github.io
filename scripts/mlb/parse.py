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
揮棒判斷用的 call code。

statsapi 沒有「這球有沒有揮棒」的布林欄位，只有 details.call.code，
所以只能從代碼反推。實測一天 10 場共 2963 球，代碼只出現這 13 種：
B F C X S D *B E T W L H M。剩下的（Q 揮棒 pitchout、R 界外 pitchout、
O 觸擊擦棒、P pitchout、I 故意四壞、V 自動壞球）罕見但照樣列進來，
漏掉的話那幾球會被當成沒揮棒，把分母算歪。

界外（F）跟觸擊界外（L）是揮了而且碰到了，一定要算進揮棒數——
少了它們追打率的分母會少三分之一。
"""
_SWING_CODES = frozenset(
    ["S", "W", "T", "M", "Q", "F", "L", "R", "O", "X", "D", "E"]
)

"""
揮空。擦棒被捕（T）算不算揮空是唯一有疑問的一項，用實測決定：

    含 T  23.87%   不含 T  21.88%   聯盟公布值約 24%

所以官方是把 T 當揮空算的（擦棒被捕在記錄上就是揮棒落空的三振），
含 T 才對得起來。界外（F/L/R）是實打實的碰到，不算。
"""
_WHIFF_CODES = frozenset(["S", "W", "T", "M", "Q"])


def is_swing(call_code):
    """這球打者有沒有揮棒。看不懂的代碼一律當沒揮，寧可低估也不要灌水。"""
    return call_code in _SWING_CODES


def is_whiff(call_code):
    """揮了而且完全沒碰到。必然是 is_swing 的子集，測試有守這條。"""
    return call_code in _WHIFF_CODES


def in_zone(zone):
    """
    這球進不進好球帶。statsapi 的 zone：1~9 是帶內的九宮格，11~14 是帶外四角。

    回三種值不是兩種——zone 缺值時回 None，讓呼叫端可以把這球整個跳過。
    回 False 的話這球會被算進「帶外」的分母，追打率就被稀釋了。
    實測 291 球沒有一顆缺 zone，但不能假設它永遠都在。
    """
    if zone is None:
        return None
    try:
        z = int(zone)
    except (TypeError, ValueError):
        return None
    if 1 <= z <= 9:
        return True
    if 11 <= z <= 14:
        return False
    return None


def is_sweet_spot(launch_angle):
    """
    甜蜜點：仰角 8~32 度，Statcast 的公開定義。

    這一項補的是 is_hard_hit 看不到的事——強擊球只看初速，
    所以 105 mph 的滾地球跟 105 mph 的平飛球算同一件事。
    實測一天 511 顆擊球是 31.9%，聯盟約 33%，對得起來。
    """
    if launch_angle is None:
        return False
    try:
        angle = float(launch_angle)
    except (TypeError, ValueError):
        return False
    return 8.0 <= angle <= 32.0


"""
打席結果的分類，連續安打／連續上壘要靠它把 playByPlay 還原成官方打擊成績。

三個集合的答案是抄 statsapi 自己的 /v1/eventTypes——那份 meta 每一種事件
都標了 plateAppearance 與 hit 兩個旗標，不是看描述自己猜的。

為什麼用白名單而不是「排掉幾種跑壘事件」：allPlays 裡 result.type 寫著
"atBat" 的 play 不一定是一次打席。跑者在打席進行中被牽制出局、半局就這樣
結束的話，那個 play 會掛在當時站在打擊區的人身上、type 也照樣是 "atBat"，
但事件是 pickoff_caught_stealing_2b，官方紀錄上他那個打席根本不存在
（實例：2026-09-01 的 Ty France，PBP 看起來 5 個打席，boxscore 寫 4 打數）。
黑名單漏一種就會多算一個打數，白名單漏一種只會少算，而且對得出來。

驗證方式：12 場、266 名打者，從 PBP 推出來的 AB／H／BB／HBP／PA
拿去比官方 boxscore 的同四欄，零筆不合。
"""
_PA_EVENTS = frozenset([
    "single", "double", "triple", "home_run",
    "field_out", "force_out", "fielders_choice", "fielders_choice_out",
    "double_play", "grounded_into_double_play", "triple_play",
    "strikeout", "strike_out", "strikeout_double_play", "strikeout_triple_play",
    "field_error", "batter_interference", "fan_interference",
    "walk", "intent_walk", "hit_by_pitch",
    "sac_fly", "sac_fly_double_play", "sac_bunt", "sac_bunt_double_play",
    "catcher_interf",
])

_HIT_EVENTS = frozenset(["single", "double", "triple", "home_run"])

# 上了打席但不算「打數」：四壞、故意四壞、觸身、高飛犧牲打、犧牲觸擊、妨礙打擊。
# 打數 0 是連續安打那條豁免的入口，但這一組不等於那條豁免：
# 高飛犧牲打在這裡面，它卻是會中斷連續安打的。差別由 _SAC_FLY_EVENTS 處理，見下面。
_NON_AB_EVENTS = frozenset([
    "walk", "intent_walk", "hit_by_pitch",
    "sac_fly", "sac_fly_double_play", "sac_bunt", "sac_bunt_double_play",
    "catcher_interf",
])

"""
上壘只認安打、四壞、觸身這三種。

失誤上壘（field_error）和野手選擇（fielders_choice）不算——
官方的連續上壘紀錄就是不算它們，而且那兩種本來就不是打者的功勞。
妨礙打擊（catcher_interf）也不算，理由一樣。
"""
_ON_BASE_EVENTS = _HIT_EVENTS | frozenset(["walk", "intent_walk", "hit_by_pitch"])

"""
高飛犧牲打要跟犧牲觸擊分開數，因為官方規則對這兩者的處理相反。

規則 9.23(b)：整場的打席全部是四壞、觸身、妨礙打擊或「犧牲觸擊」的話，
連續安打不中斷；但只要有一次「高飛犧牲打」而且沒安打，連續安打就斷了。

兩者都不算打數，所以光看打數是 0 分不出來——一場三次四壞的比賽要跳過，
一場兩次四壞加一次高飛犧牲打的比賽要中斷，而兩場的打數都是 0。
"""
_SAC_FLY_EVENTS = frozenset(["sac_fly", "sac_fly_double_play"])


def is_plate_appearance(event_type):
    """這個 play 算不算打者的一次打席。看不懂的事件一律不算。"""
    return event_type in _PA_EVENTS


def is_hit(event_type):
    """一安到全壘打。"""
    return event_type in _HIT_EVENTS


def is_at_bat(event_type):
    """算不算一個打數。必然是 is_plate_appearance 的子集，測試有守這條。"""
    return event_type in _PA_EVENTS and event_type not in _NON_AB_EVENTS


def reached_base(event_type):
    """打者有沒有靠自己上壘（安打／四壞／觸身）。"""
    return event_type in _ON_BASE_EVENTS


def is_sac_fly(event_type):
    """高飛犧牲打。不是打數，但會中斷連續安打，所以要單獨數一欄。"""
    return event_type in _SAC_FLY_EVENTS


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
