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
slug = lambda rows: [r for r in rows if r["name"] == "Slugger"][0]  # noqa: E731
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

print("\n%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
