# -*- coding: utf-8 -*-
"""
parse.py 的測試。跑法：python scripts/mlb/test_parse.py

測資全部是 2026-08-30~31 從 statsapi 實際抓下來的原句，不是自己編的，
包含 MLB 自己資料裡的錯字（Left wrist tracture）——那些照樣要能解析。
CI 會跑這支，失敗就讓整個 workflow 停下來，不要拿壞掉的 parser 去產資料。
"""

import sys
from datetime import date

sys.path.insert(0, __file__.rsplit("\\", 1)[0].rsplit("/", 1)[0])

import parse  # noqa: E402

passed = 0
failed = 0
current_group = ""


def group(name):
    global current_group
    current_group = name
    print("\n== " + name)


def check(label, actual, expected):
    global passed, failed
    if actual == expected:
        passed += 1
        print("  ok   " + label)
    else:
        failed += 1
        print("  FAIL " + label)
        print("       預期 %r" % (expected,))
        print("       實際 %r" % (actual,))


group("進 IL：基本")
m = parse.parse_move(
    "San Diego Padres placed 1B Gavin Sheets on the 10-day injured list. Left foot sprain.",
    "2026-08-31",
)
check("action", m["action"], "placed")
check("天數", m["days"], 10)
check("傷勢", m["injury"], "Left foot sprain")
check("沒有 retroactive", m["retro_date"], None)
check("起算日用異動日", m["start_date"], date(2026, 8, 31))
check("最快回歸日", parse.earliest_return(m["start_date"], m["days"]), date(2026, 9, 10))

group("進 IL：retroactive")
m = parse.parse_move(
    "Minnesota Twins placed CF Byron Buxton on the 10-day injured list "
    "retroactive to August 27, 2026. Right hip impingement.",
    "2026-08-31",
)
check("天數", m["days"], 10)
check("retroactive 日", m["retro_date"], date(2026, 8, 27))
check("起算日用 retroactive 而非異動日", m["start_date"], date(2026, 8, 27))
check("傷勢不含 retroactive 那句", m["injury"], "Right hip impingement")
check("最快回歸日", parse.earliest_return(m["start_date"], m["days"]), date(2026, 9, 6))

m = parse.parse_move(
    "Los Angeles Angels placed RHP George Klassen on the 15-day injured list "
    "retroactive to August 27, 2026. Left low back inflammation.",
    "2026-08-30",
)
check("15 天", m["days"], 15)
check("最快回歸日", parse.earliest_return(m["start_date"], m["days"]), date(2026, 9, 11))

group("轉 60 天 IL")
m = parse.parse_move(
    "Seattle Mariners transferred SS Colt Emerson from the 10-day injured list "
    "to the 60-day injured list. Left wrist tendon repair.",
    "2026-08-31",
)
check("action", m["action"], "transferred")
check("天數取 to 後面的 60 而不是 from 的 10", m["days"], 60)
check("傷勢", m["injury"], "Left wrist tendon repair")

group("啟動歸隊")
m = parse.parse_move(
    "Boston Red Sox activated LF Roman Anthony from the 60-day injured list.", "2026-08-31"
)
check("action", m["action"], "activated")
check("天數", m["days"], 60)
check("沒有傷勢文字", m["injury"], None)

group("非傷兵名單")
m = parse.parse_move(
    "Chicago White Sox activated LHP Tyler Schweitzer from the paternity list.", "2026-08-31"
)
check("歸類為 paternity", m["list_kind"], "paternity")
check("沒有天數", m["days"], None)
check("不當傷兵但要解析得出來", m["action"], "activated")

group("要被跳過的異動")
check(
    "復健賽指派不是 IL 異動",
    parse.parse_move(
        "Texas Rangers sent RHP Carter Baumler on a rehab assignment to Round Rock Express.",
        "2026-08-30",
    ),
    None,
)
check(
    "call-up 不是 IL 異動",
    parse.parse_move(
        "New York Yankees recalled RHP Luis Gil from Scranton/Wilkes-Barre RailRiders.",
        "2026-08-31",
    ),
    None,
)
check("空字串", parse.parse_move("", "2026-08-31"), None)
check("None", parse.parse_move(None, None), None)

group("MLB 原始資料的髒東西")
m = parse.parse_move(
    "Chicago Cubs placed RHP Shelby Miller on the 60-day injured list. Right Elbow UCL Injury.",
    "2026-03-01",
)
check("大小寫不一致的傷勢照樣收", m["injury"], "Right Elbow UCL Injury")
m = parse.parse_move(
    "Boston Red Sox placed 3B Curtis Mead on the 10-day injured list. Left wrist tracture.",
    "2026-08-20",
)
check("MLB 自己打錯字也不要修", m["injury"], "Left wrist tracture")

group("最快回歸日的邊界")
check("缺天數回 None", parse.earliest_return(date(2026, 9, 1), None), None)
check("缺起算日回 None", parse.earliest_return(None, 10), None)
check("還有幾天", parse.days_until(date(2026, 9, 6), date(2026, 9, 1)), 5)
check("已經過了是負的", parse.days_until(date(2026, 8, 28), date(2026, 9, 1)), -4)

group("強擊球判定")
check("107.3 是強擊球", parse.is_hard_hit(107.3), True)
check("95.0 剛好達標", parse.is_hard_hit(95.0), True)
check("94.4 不算", parse.is_hard_hit(94.4), False)
check("沒有初速資料不算", parse.is_hard_hit(None), False)
check("髒值不要炸掉", parse.is_hard_hit("abc"), False)

group("Barrel：初速門檻")
check("97.9 mph 角度再漂亮也不是", parse.is_barrel(97.9, 28), False)
check("95 mph 是強擊球但不是 barrel", parse.is_barrel(95.0, 28), False)

group("Barrel：98 mph 的區間剛好是 26~30 度")
check("26 度算", parse.is_barrel(98.0, 26.0), True)
check("30 度算（上界要含進去）", parse.is_barrel(98.0, 30.0), True)
check("25.9 度不算", parse.is_barrel(98.0, 25.9), False)
check("30.1 度不算", parse.is_barrel(98.0, 30.1), False)

group("Barrel：116 mph 放寬成 8~50 度")
check("8 度算", parse.is_barrel(116.0, 8.0), True)
check("50 度算", parse.is_barrel(116.0, 50.0), True)
check("7.9 度不算", parse.is_barrel(116.0, 7.9), False)
check("50.1 度不算", parse.is_barrel(116.0, 50.1), False)
# 沒有夾住的話 120 mph 會算出 4~54 度，那個區間不存在
check("120 mph 不會再往外擴（7 度還是不算）", parse.is_barrel(120.0, 7.0), False)
check("120 mph 的 51 度也不算", parse.is_barrel(120.0, 51.0), False)

group("Barrel：實際打出來的球")
# 這幾顆是 2026-08-29~31 playByPlay 裡真的被打出來的
check("Wilyer Abreu 108.5 mph / 19 度", parse.is_barrel(108.5, 19.0), True)
check("Gleyber Torres 98.2 mph / 26 度", parse.is_barrel(98.2, 26.0), True)
check("高初速但打進地上：101 mph / -5 度", parse.is_barrel(101.0, -5.0), False)
check("高飛球出局：99 mph / 45 度", parse.is_barrel(99.0, 45.0), False)

group("Barrel：缺值")
check("沒有仰角就不算", parse.is_barrel(105.0, None), False)
check("沒有初速就不算", parse.is_barrel(None, 25.0), False)
check("兩個都沒有", parse.is_barrel(None, None), False)
check("髒值不要炸掉", parse.is_barrel("abc", "def"), False)

group("甜蜜點：仰角 8~32 度")
check("平飛 20 度", parse.is_sweet_spot(20.0), True)
check("8 度剛好進", parse.is_sweet_spot(8.0), True)
check("32 度剛好進", parse.is_sweet_spot(32.0), True)
check("7.9 度是滾地", parse.is_sweet_spot(7.9), False)
check("32.1 度太高", parse.is_sweet_spot(32.1), False)
check("打進地上的負角度", parse.is_sweet_spot(-12.0), False)
check("沖天炮 60 度", parse.is_sweet_spot(60.0), False)
# 這一項存在的理由：同樣是強擊球，滾地跟平飛差很多
check("105 mph 滾地球不是甜蜜點", parse.is_sweet_spot(-3.0), False)
check("缺值", parse.is_sweet_spot(None), False)
check("髒值不要炸掉", parse.is_sweet_spot("abc"), False)

group("揮棒判定")
check("揮空 S", parse.is_swing("S"), True)
check("被擋住的揮空 W", parse.is_swing("W"), True)
check("擦棒被捕 T", parse.is_swing("T"), True)
check("界外 F 是揮了而且碰到了", parse.is_swing("F"), True)
check("觸擊界外 L", parse.is_swing("L"), True)
check("觸擊落空 M", parse.is_swing("M"), True)
check("擊出去 X／D／E 都是揮棒",
      [parse.is_swing(c) for c in ("X", "D", "E")], [True, True, True])
check("好球被喊的 C 沒有揮", parse.is_swing("C"), False)
check("壞球 B 沒有揮", parse.is_swing("B"), False)
check("落地壞球 *B 沒有揮", parse.is_swing("*B"), False)
check("觸身球 H 沒有揮", parse.is_swing("H"), False)
# 看不懂的代碼寧可低估也不要灌水——算成揮棒會讓揮空率的分母膨脹
check("沒看過的代碼當沒揮", parse.is_swing("ZZ"), False)
check("None", parse.is_swing(None), False)

group("揮空判定")
check("S 是揮空", parse.is_whiff("S"), True)
check("W 是揮空", parse.is_whiff("W"), True)
# 實測：含 T 是 23.87%、不含是 21.88%，聯盟公布約 24%，所以官方把 T 算揮空
check("擦棒被捕 T 算揮空（實測對得上聯盟值）", parse.is_whiff("T"), True)
check("觸擊落空 M 算揮空", parse.is_whiff("M"), True)
check("界外 F 碰到了不算揮空", parse.is_whiff("F"), False)
check("觸擊界外 L 不算揮空", parse.is_whiff("L"), False)
check("擊出去的球不算揮空",
      [parse.is_whiff(c) for c in ("X", "D", "E")], [False, False, False])
check("沒揮的球不算揮空", parse.is_whiff("C"), False)
check("None", parse.is_whiff(None), False)

group("揮空必然是揮棒的子集")
# 這條是不變式，不是抽樣。任何一個代碼只要「揮空但沒揮棒」，
# 揮空率就會 > 100%，而那種數字看起來像 bug 而不是像資料。
# 兩個集合各自維護，很容易改了一邊忘了另一邊，所以在這裡守住。
bad = sorted(c for c in parse._WHIFF_CODES if not parse.is_swing(c))
check("每個揮空代碼都算揮棒", bad, [])
check("揮空的種類比揮棒少", len(parse._WHIFF_CODES) < len(parse._SWING_CODES), True)

group("好球帶：三種答案不是兩種")
check("正中紅心 5", parse.in_zone(5), True)
check("帶內左上角 1", parse.in_zone(1), True)
check("帶內右下角 9", parse.in_zone(9), True)
check("帶外 11", parse.in_zone(11), False)
check("帶外 14", parse.in_zone(14), False)
check("字串型的 zone 也讀得懂", parse.in_zone("13"), False)
# 10 不存在（1~9 帶內、11~14 帶外，中間跳過 10）
check("10 不是合法 zone", parse.in_zone(10), None)
check("15 以上不是合法 zone", parse.in_zone(15), None)
"""
缺值一定要回 None 而不是 False。回 False 的話這球會被算進「帶外」的分母，
追打率就被不知道的球稀釋掉；回 True 則會讓分母縮水。
兩種都是把不知道的事當成知道。
"""
check("缺值回 None 不回 False", parse.in_zone(None), None)
check("髒值回 None", parse.in_zone("abc"), None)
check("None 不等於 False", parse.in_zone(None) is False, False)

group("新聞分類")
check(
    "傷兵",
    parse.categorize("Mets place Kodai Senga on 15-day IL with hamstring strain"),
    "injury",
)
check(
    "簽約異動",
    parse.categorize("Cardinals designate veteran reliever for assignment"),
    "move",
)
check(
    "分析預測",
    parse.categorize("Fantasy Baseball Week 22 Waiver Wire Rankings"),
    "analysis",
)
check("其他", parse.categorize("Yankees beat Red Sox 6-3 behind three home runs"), "other")

group("新聞分類：優先序")
# 傷兵要排在分析前面，不然這種標題會被歸到分析，而使用者想在傷兵那類找到它
check(
    "fantasy 傷兵專欄歸傷兵不歸分析",
    parse.categorize("Fantasy Baseball Injury Report: Who to stash this week"),
    "injury",
)
# 異動要排在分析前面，「新秀被叫上來」是事實不是分析
check(
    "新秀升上大聯盟歸異動不歸分析",
    parse.categorize("Top prospect called up to make MLB debut Friday"),
    "move",
)

group("新聞分類：實際漏掉過的異動寫法")
# 以下四則都是實測 RSS 撈回來、原本被丟進「其他」的真標題
check(
    "select 是選上合約",
    parse.categorize("Pirates Select Christian Bethancourt"),
    "move",
)
check(
    "To Select 也算",
    parse.categorize("Nationals To Select Jared Simpson"),
    "move",
)
check(
    "selected the contract",
    parse.categorize("Mets selected the contract of RHP Jose Butto"),
    "move",
)
check(
    "calling up",
    parse.categorize("Reports: Padres calling up catching phenom Salas"),
    "move",
)
check("連字號的 call-up", parse.categorize("Braves announce call-up of top arm"), "move")
check("複數 call-ups", parse.categorize("Five September call-ups worth adding"), "move")

group("新聞分類：短字不要亂咬")
check("until 裡的 il 不算傷兵", parse.categorize("Rain delay pushes first pitch until 8pm"), "other")
check("assign 不是 sign", parse.categorize("Reassigned to minor league camp"), "other")
check("years 裡的 tear 不算傷兵", parse.categorize("Best seasons of the last ten years"), "other")
# 「回歸」的說法太雜（booed in return、return to Detroit），刻意不收 return 當關鍵字，
# 寧可讓這種標題留在「其他」，也不要把一堆非異動的東西倒進異動
check(
    "return 不當異動關鍵字",
    parse.categorize("Marte says he 'failed' Lovullo, booed in return"),
    "other",
)
# selection 講的是入選跟選秀，不是「選上合約」
check("All-Star selections 不算異動", parse.categorize("All-Star selections announced"), "other")
check("空標題", parse.categorize(""), "other")
check("None", parse.categorize(None), "other")

# ---------------------------------------------------------------------------
# 時間窗彙總。這段測的是 hardhit.py，但它跟 parse.py 一樣是純函式
#（吃一份 dict、吐一份 list，不碰網路也不碰檔案），所以放同一支測試裡跑。
# ---------------------------------------------------------------------------

TODAY = date(2026, 9, 1)


def game(day, batters):
    return {"date": day, "batters": batters}


def bat(name, team, bb, hh, br):
    return {"name": name, "teamId": team, "bb": bb, "hh": hh, "br": br,
            "max": 105.0, "sum": bb * 95.0}


# 三種打者：
#   1 長打者  每場都有 barrel
#   2 樣本少  只出現一場、比率 100%，應該被門檻擋掉
#   3 滾地王  強擊球很多但一顆 barrel 都沒有
def five_games():
    return {
        "games": {
            "a": game("2026-09-01", {"1": bat("Slugger", 147, 4, 3, 1),
                                     "2": bat("Sparse", 147, 2, 2, 1),
                                     "3": bat("Grounder", 111, 5, 4, 0)}),
            "b": game("2026-08-30", {"1": bat("Slugger", 147, 4, 3, 1),
                                     "3": bat("Grounder", 111, 5, 4, 0)}),
            "c": game("2026-08-27", {"1": bat("Slugger", 147, 4, 3, 1),
                                     "3": bat("Grounder", 111, 5, 4, 0)}),
            "d": game("2026-08-20", {"1": bat("Slugger", 147, 4, 3, 1),
                                     "3": bat("Grounder", 111, 5, 4, 0)}),
            # 20 天前，三個窗都不該看到它
            "e": game("2026-08-10", {"1": bat("Slugger", 147, 4, 3, 1),
                                     "3": bat("Grounder", 111, 5, 4, 0)}),
        }
    }


import hardhit  # noqa: E402

cache = five_games()
hh14 = hardhit.leaderboard(cache, 14, TODAY, "hh", 10)
hh7 = hardhit.leaderboard(cache, 7, TODAY, "hh", 6)
hh3 = hardhit.leaderboard(cache, 3, TODAY, "hh", 3)

group("時間窗：只算窗內的場次")
check("14 天看得到 4 場（20 天前那場不算）", hh14[0]["games"], 4)
check("7 天看得到 3 場", [r for r in hh7 if r["name"] == "Slugger"][0]["games"], 3)
check("3 天看得到 2 場", [r for r in hh3 if r["name"] == "Slugger"][0]["games"], 2)

group("時間窗：窗愈短數字愈小")


def slug_by(name, rows):
    """從榜上撈某個人。撈不到就讓 IndexError 炸出來——
    測試裡「他不在榜上」跟「他的數字錯了」是兩種失敗，不要混成一種。"""
    return [r for r in rows if r["name"] == name][0]


slug = lambda rows: slug_by("Slugger", rows)  # noqa: E731
check("14 天強擊球 12", slug(hh14)["hardHits"], 12)
check("7 天強擊球 9", slug(hh7)["hardHits"], 9)
check("3 天強擊球 6", slug(hh3)["hardHits"], 6)
check("14 天擊球數 16", slug(hh14)["battedBalls"], 16)
check("3 天擊球數 8", slug(hh3)["battedBalls"], 8)

group("時間窗：出場門檻")
# Sparse 只打了 2 球、硬擊率 100%，三個窗的門檻都該把他擋掉，
# 不然 3 天榜首永遠是這種人
check("14 天沒有 Sparse", [r["name"] for r in hh14].count("Sparse"), 0)
check("7 天沒有 Sparse", [r["name"] for r in hh7].count("Sparse"), 0)
check("3 天沒有 Sparse", [r["name"] for r in hh3].count("Sparse"), 0)
check("門檻放寬到 1 就進得來",
      [r["name"] for r in hardhit.leaderboard(cache, 3, TODAY, "hh", 1)].count("Sparse"), 1)

group("強擊球榜與 barrel 榜排出來不一樣")
br14 = hardhit.leaderboard(cache, 14, TODAY, "br", 10)
check("強擊球榜第一是滾地王（16 顆）", hh14[0]["name"], "Grounder")
check("滾地王的 barrel 是 0", hh14[0]["barrels"], 0)
check("barrel 榜第一是長打者", br14[0]["name"], "Slugger")
check("barrel 榜 4 顆", br14[0]["barrels"], 4)
# 一顆都沒有的人不該佔著排行的位置
check("barrel 榜不含 0 顆的滾地王", [r["name"] for r in br14].count("Grounder"), 0)
check("每一列兩種數字都在", sorted(hh14[0].keys()) == sorted(br14[0].keys()), True)

group("三個窗一次算完")
b = hardhit.boards(cache, TODAY, "hh")
check("三個 key", sorted(b.keys()), ["d14", "d3", "d7"])
check("d14 跟單獨算的一樣", b["d14"], hh14)
check("d3 跟單獨算的一樣", b["d3"], hh3)

group("時間窗：空快取不要炸掉")
check("沒有 games", hardhit.leaderboard({}, 14, TODAY, "hh", 10), [])
check("games 是空的", hardhit.leaderboard({"games": {}}, 3, TODAY, "br", 1), [])

group("舊格式的紀錄不要炸掉")
# 上面那份 five_games() 的打者只有 bb/hh/br，沒有選球與仰角欄位。
# 快取升版會整份重建，所以正式流程不會遇到，但彙總不該假設欄位一定在。
old = slug(hh14)
check("沒有仰角資料就不給甜蜜點率", old["sweetSpotRate"], None)
check("沒有仰角資料就不給平均仰角", old["avgLA"], None)
check("沒有帶外球數就不給追打率", old["chaseRate"], None)
check("沒有揮棒數就不給揮空率", old["whiffRate"], None)
# 回 0 的話畫面會顯示「追打率 0%」——那是在宣稱一件我們沒量到的事
check("是 None 不是 0", old["chaseRate"] is None, True)
check("看球數是 0", old["pitches"], 0)


# ---------------------------------------------------------------------------
# 選球與甜蜜點的分母。這一段防的是「拿擊球數當所有東西的分母」，
# 那是接上逐球統計之後最容易犯的錯：一個打席可能看六球才出局，
# 也可能第一球就打掉，所以看球數跟擊球數是兩個世界。
# ---------------------------------------------------------------------------


def bat_full(name, team, **kw):
    rec = {"name": name, "teamId": team, "max": 108.0,
           "bb": 0, "hh": 0, "br": 0, "ss": 0, "lan": 0, "la": 0.0, "sum": 0.0,
           "p": 0, "oz": 0, "ch": 0, "sw": 0, "wh": 0}
    rec.update(kw)
    rec["sum"] = rec["bb"] * 95.0
    return rec


# 每個分母都不一樣，所以拿錯任何一個都會算出不同的數字：
#   甜蜜點 6/8=.750   追打 6/20=.300   揮空 4/16=.250   強擊 4/10=.400
# 全部拿 bb=10 當分母的話會變成 .600/.600/.400，四條都會紅。
DENOM = {
    "games": {
        "g": {"date": "2026-09-01", "batters": {"7": bat_full(
            "Picky", 147, bb=10, hh=4, br=2, ss=6, lan=8, la=120.0,
            p=40, oz=20, ch=6, sw=16, wh=4)}}
    }
}
row = hardhit.leaderboard(DENOM, 3, TODAY, "hh", 1)[0]

group("選球的分母不是擊球數")
check("追打率用帶外球數當分母", row["chaseRate"], 0.3)
check("揮空率用揮棒數當分母", row["whiffRate"], 0.25)
check("看球數原樣輸出", row["pitches"], 40)
check("強擊率還是用擊球數", row["hardHitRate"], 0.4)

group("甜蜜點與平均仰角的分母是有仰角的擊球數")
# 缺仰角的球要退出分母，不是當成 0 度——0 度是滾地球，不是「不知道」
check("甜蜜點率 6/8 而不是 6/10", row["sweetSpotRate"], 0.75)
check("平均仰角 120/8 而不是 120/10", row["avgLA"], 15.0)


group("平均初速")
# 平均初速是所有打擊指標裡穩定得最快的（約 40 顆擊球），14 天對多數先發剛好夠。
# 卡片上原本顯示的是最高初速，但那是 n 顆球的極大值——出賽多的人天生就會比較高，
# 拿來跨球員比較是不公平的。平均沒有這個問題。
check("平均初速", row["avgEV"], 95.0)
check("最高初速還在（排序的第三順位要用）", row["maxEV"], 108.0)

print("\n%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
