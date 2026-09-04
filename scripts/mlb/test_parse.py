# -*- coding: utf-8 -*-
"""
parse.py 的測試。跑法：python scripts/mlb/test_parse.py

測資全部是 2026-08-30~31 從 statsapi 實際抓下來的原句，不是自己編的，
包含 MLB 自己資料裡的錯字（Left wrist tracture）——那些照樣要能解析。
CI 會跑這支，失敗就讓整個 workflow 停下來，不要拿壞掉的 parser 去產資料。
"""

import sys
from datetime import date, timedelta

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

group("打席結果：算不算一次打席")
check("一安", parse.is_plate_appearance("single"), True)
check("三振", parse.is_plate_appearance("strikeout"), True)
check("四壞", parse.is_plate_appearance("walk"), True)
check("高飛犧牲打", parse.is_plate_appearance("sac_fly"), True)
"""
這一條是白名單存在的理由。跑者在打席進行中被牽制出局、半局就這樣結束的話，
那個 play 掛在當時站在打擊區的人身上、result.type 也照樣寫 "atBat"，
但官方紀錄上他那個打席不存在。
實例：2026-09-01 的 Ty France，PBP 看起來 5 個打席，boxscore 寫 4 打數。
"""
check("牽制阻殺不是打席", parse.is_plate_appearance("pickoff_caught_stealing_2b"), False)
check("盜壘不是打席", parse.is_plate_appearance("stolen_base_2b"), False)
check("暴投不是打席", parse.is_plate_appearance("wild_pitch"), False)
# 看不懂的事件寧可少算也不要多算：多算會讓打數憑空多一個而且對不出來
check("沒看過的事件不算", parse.is_plate_appearance("some_new_event_2027"), False)
check("None", parse.is_plate_appearance(None), False)

group("打席結果：打數與安打")
check("二壘打是安打也是打數",
      [parse.is_hit("double"), parse.is_at_bat("double")], [True, True])
check("全壘打是安打", parse.is_hit("home_run"), True)
check("三振是打數但不是安打",
      [parse.is_at_bat("strikeout"), parse.is_hit("strikeout")], [True, False])
check("失誤上壘是打數但不是安打",
      [parse.is_at_bat("field_error"), parse.is_hit("field_error")], [True, False])
check("野手選擇是打數", parse.is_at_bat("fielders_choice"), True)
# 這幾種是「有打席但沒有打數」，連續安打的整場跳過規則全靠它們
check("四壞不是打數", parse.is_at_bat("walk"), False)
check("故意四壞不是打數", parse.is_at_bat("intent_walk"), False)
check("觸身不是打數", parse.is_at_bat("hit_by_pitch"), False)
check("犧牲觸擊不是打數", parse.is_at_bat("sac_bunt"), False)
check("妨礙打擊不是打數", parse.is_at_bat("catcher_interf"), False)
# 高飛犧牲打也不算打數，但它不能跟上面那幾種一起跳過，見下一組
check("高飛犧牲打不是打數", parse.is_at_bat("sac_fly"), False)

group("打席結果：上壘")
check("安打算上壘", parse.reached_base("single"), True)
check("四壞算上壘", parse.reached_base("walk"), True)
check("故意四壞算上壘", parse.reached_base("intent_walk"), True)
check("觸身算上壘", parse.reached_base("hit_by_pitch"), True)
"""
下面三種人是站上壘包了，但官方的連續上壘紀錄不算它們——
上壘率的分子本來就只有安打、四壞、觸身三項，
而且失誤與野手選擇不是打者的功勞。
"""
check("失誤上壘不算", parse.reached_base("field_error"), False)
check("野手選擇不算", parse.reached_base("fielders_choice"), False)
check("妨礙打擊不算", parse.reached_base("catcher_interf"), False)
check("高飛犧牲打不算", parse.reached_base("sac_fly"), False)

group("高飛犧牲打要跟犧牲觸擊分開")
"""
規則 9.23(b) 對這兩者的處理是相反的：整場打席全是四壞、觸身、妨礙打擊
或「犧牲觸擊」的話連續安打不中斷；但有一次「高飛犧牲打」而且沒安打就斷。

兩者都不算打數，所以只看 is_at_bat 分不出來——這個函式存在的唯一理由
就是把這兩種拆開。少了它，一場兩次四壞加一次高飛犧牲打的比賽
會跟一場三次四壞的比賽走同一條路，而正確答案剛好相反。
"""
check("高飛犧牲打", parse.is_sac_fly("sac_fly"), True)
# 高飛犧牲打造成雙殺是另一個 eventType，漏掉的話那種比賽會被當成整場跳過
check("高飛犧牲打雙殺也是", parse.is_sac_fly("sac_fly_double_play"), True)
check("犧牲觸擊不是（規則對它的處理相反）", parse.is_sac_fly("sac_bunt"), False)
check("四壞不是", parse.is_sac_fly("walk"), False)
check("一般高飛球出局不是", parse.is_sac_fly("field_out"), False)
check("None 不會炸", parse.is_sac_fly(None), False)
check("每種高飛犧牲打都算打席", sorted(parse._SAC_FLY_EVENTS - parse._PA_EVENTS), [])
check("每種高飛犧牲打都不算打數",
      sorted(c for c in parse._SAC_FLY_EVENTS if parse.is_at_bat(c)), [])

group("打席分類的包含關係")
"""
這四條是不變式，不是抽樣。三個集合各自維護，改了一邊忘了另一邊
就會在畫面上出現「7 場連續安打但只有 6 支安打」這種自相矛盾的數字，
而那看起來像 bug 不像資料。fetch 的健檢也守同一條，這裡是提早攔。
"""
check("非打數的事件都在打席清單裡", sorted(parse._NON_AB_EVENTS - parse._PA_EVENTS), [])
check("每種安打都算打席", sorted(parse._HIT_EVENTS - parse._PA_EVENTS), [])
check("每種上壘都算打席", sorted(parse._ON_BASE_EVENTS - parse._PA_EVENTS), [])
check("每種安打都算打數", sorted(c for c in parse._HIT_EVENTS if not parse.is_at_bat(c)), [])
check("每種安打都算上壘", sorted(parse._HIT_EVENTS - parse._ON_BASE_EVENTS), [])

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


# ---------------------------------------------------------------------------
# 連續安打與連續上壘。hitstreaks.py 也是純函式（吃快取 dict 吐 list），
# 一樣放這支跑。這一段守的是三件容易寫錯又不容易看出來的事：
#   1 沒有打數的比賽不算中斷也不算延續
#   2 窗內與整季兩份資料不能混著算，會在接縫上重複計算場次
#   3 打到一半的比賽不能進來，會讓連續場次當場歸零、下個打席又跳回來
# ---------------------------------------------------------------------------

import hitstreaks  # noqa: E402


def days(n, start=date(2026, 8, 1)):
    return [(start + timedelta(days=i)).isoformat() for i in range(n)]


def line(day, ab, h, pa, ob, sf=0):
    """一場的打擊成績。pk 只有同一天的雙重賽排序用得到，這裡用日期當 pk 就夠。

    sf（高飛犧牲打）預設 0，只有規則 9.23(b) 那組會給值——
    每一列都寫出來會讓人以為它跟其他測試有關係。"""
    return {"date": day, "pk": day, "ab": ab, "h": h, "pa": pa, "ob": ob, "sf": sf}


def multi_cache(players):
    """players 是 {pid: (名字, [(日期, ab, h, pa, ob[, sf]), ...])} → 強擊球快取的形狀。"""
    games = {}
    for pid, (name, rows) in players.items():
        for row in rows:
            day, ab, h, pa, ob = row[:5]
            g = games.setdefault(day, {"date": day, "batters": {}})
            g["batters"][pid] = {"name": name, "teamId": 147,
                                 "ab": ab, "h": h, "pa": pa, "ob": ob,
                                 "sf": row[5] if len(row) > 5 else 0}
    return {"games": games}


def log_rows(rows, kind="R"):
    """整季逐場的 API 形狀。rows 是 [(日期, ab, h, pa, bb, hbp[, sf]), ...]。

    gamePk 直接用日期字串——擋進行中的比賽只在乎它跟快取的 key 對不對得上。"""
    out = []
    for row in rows:
        day, ab, h, pa, bb, hbp = row[:6]
        out.append(
            {"date": day, "gameType": kind, "game": {"gamePk": day},
             "stat": {"atBats": ab, "hits": h, "plateAppearances": pa,
                      "baseOnBalls": bb, "hitByPitch": hbp,
                      "sacFlies": row[6] if len(row) > 6 else 0}}
        )
    return out


group("連續安打：從最後一場往回數")
r = hitstreaks.run([
    line("2026-08-28", 4, 0, 4, 0),   # 0 安，斷在這裡
    line("2026-08-29", 4, 1, 4, 1),
    line("2026-08-30", 3, 2, 4, 3),
    line("2026-08-31", 4, 1, 4, 1),
], "hit")
check("三場", r["games"], 3)
check("起算日是這段的第一場", r["since"], "2026-08-29")
check("安打累計", r["h"], 4)
check("打數累計不含被斷掉那場", r["ab"], 11)
check("有斷過，不用往前補", r["broke"], True)

group("連續安打：沒有打數的比賽整場跳過")
"""
官方規則：整場只有四壞、犧牲打（打數 0）的比賽既不中斷也不延續連續安打。
少了這一條，一場保送兩次的比賽會把 20 場的連續安打砍成 0——
而那不是「保守估計」，是印一個錯的數字在畫面上。
"""
walked = [
    line("2026-08-29", 4, 1, 4, 1),
    line("2026-08-30", 0, 0, 2, 2),   # 兩次四壞，沒有打數
    line("2026-08-31", 4, 1, 4, 1),
]
r = hitstreaks.run(walked, "hit")
check("只保送的那場不算一場", r["games"], 2)
check("但連續沒有被它中斷（不是 1）", r["games"] != 1, True)
check("一路數到頭都沒斷", r["broke"], False)
check("起算日跳過那場，回到更早的", r["since"], "2026-08-29")
# 同一份資料換成連續上壘：那場有兩次上壘，是實實在在的一場
r = hitstreaks.run(walked, "onBase")
check("連續上壘看得到那場，三場", r["games"], 3)
check("上壘累計", r["ob"], 4)

group("連續安打：高飛犧牲打會中斷（規則 9.23(b)）")
"""
上一組那條豁免不含高飛犧牲打。官方的寫法是：整場打席全是四壞、觸身、
妨礙打擊或「犧牲觸擊」才不中斷，但「只要有一次高飛犧牲打而且沒安打就斷」。

兩場的打數都是 0，答案卻相反——所以判斷不能只看打數。
這一組跟上一組要一起看，任何一邊單獨看都會覺得另一邊寫錯了。
"""
sacfly = [
    line("2026-08-29", 4, 1, 4, 1),
    line("2026-08-30", 0, 0, 3, 2, 1),   # 兩次四壞＋一次高飛犧牲打，打數還是 0
    line("2026-08-31", 4, 1, 4, 1),
]
r = hitstreaks.run(sacfly, "hit")
check("斷在高飛犧牲打那場，只剩最後一場", r["games"], 1)
check("而且是真的斷了，不是資料不夠", r["broke"], True)
check("起算日是最後一場", r["since"], "2026-08-31")
# 同一組日期、同樣 0 打數，差別只在那一欄
check("犧牲觸擊那場（sf=0）仍然是跳過的 2 場",
      hitstreaks.run(walked, "hit")["games"], 2)
# 連續上壘沒有這條規則：高飛犧牲打不算上壘，那場本來就會斷
check("連續上壘那場沒上壘也是斷的", hitstreaks.run([
    line("2026-08-30", 0, 0, 1, 0, 1),
    line("2026-08-31", 4, 1, 4, 1),
], "onBase")["games"], 1)
# 有打數又有高飛犧牲打而且有安打：正常延續，不要被 sf 誤傷
check("有安打的話高飛犧牲打不影響", hitstreaks.run([
    line("2026-08-30", 3, 1, 5, 1, 1),
    line("2026-08-31", 4, 1, 4, 1),
], "hit")["games"], 2)

group("同一份資料，兩個榜答案不一樣")
# ob 在快取那邊就已經照 parse.reached_base 篩過了，這裡驗的是彙總只看 ob 不看 h
nohit = [
    line("2026-08-30", 3, 0, 4, 1),   # 有打數、0 安，但靠四壞上壘
    line("2026-08-31", 4, 2, 4, 2),
]
check("連續上壘兩場", hitstreaks.run(nohit, "onBase")["games"], 2)
check("連續安打只有一場（8/30 有打數但沒安打，斷了）",
      hitstreaks.run(nohit, "hit")["games"], 1)

group("連續場次：邊界")
r = hitstreaks.run([], "hit")
check("沒有資料回 0 場", r["games"], 0)
check("沒有資料不算「沒斷過」的候選（靠 games 擋）", r["broke"], False)
r = hitstreaks.run([line("2026-08-31", 4, 0, 4, 0)], "hit")
check("最後一場就掛了", r["games"], 0)
check("而且是真的斷了", r["broke"], True)
check("起算日是 None", r["since"], None)

group("候選人：判斷「有沒有斷過」而不是「數字夠不夠大」")
"""
只出賽三場、三場都上壘的替補也可能是一段 20 場的連續上壘，
他窗內的數字卻只有 3。用「夠不夠長」當條件會漏掉這種人。
"""
cands = hitstreaks.candidates(multi_cache({
    "1": ("Rolling", [(d, 4, 1, 4, 1) for d in days(6)]),
    # 最舊那場掛蛋 → 窗內就知道是 5 場，那已經是精確值，不用補
    "2": ("Stopped", [(days(6)[0], 4, 0, 4, 0)]
          + [(d, 4, 1, 4, 1) for d in days(6)[1:]]),
    "3": ("Sparse", [(d, 4, 1, 4, 1) for d in days(6)[3:]]),
    "4": ("Cold", [(d, 4, 0, 4, 0) for d in days(6)]),
    # 一直被保送沒安打：連續安打斷了，但連續上壘還在延續
    "5": ("Walker", [(d, 3, 0, 4, 1) for d in days(6)]),
}))
check("窗內沒斷過的要補", 1 in cands, True)
check("窗內就斷掉的不用補", 2 in cands, False)
check("只打三場但沒斷過的也要補", 3 in cands, True)
check("完全沒上壘的不是候選", 4 in cands, False)
check("只要有一個榜沒斷就算候選", 5 in cands, True)

group("兩個榜：門檻兩邊不一樣")
# 六場每場一安一上壘：連續安打過門檻（5），連續上壘不到（10）
six = multi_cache({"9": ("Sixer", [(d, 4, 1, 4, 1) for d in days(6)])})
b = hitstreaks.boards(six, {}, date(2026, 8, 6))
check("連續安打 6 場上榜", b["hit"][0]["games"], 6)
check("連續上壘 6 場不到 10，上不了榜", b["onBase"], [])
check("playerId 是數字不是字串", b["hit"][0]["playerId"], 9)
check("名字與球隊跟著出來", (b["hit"][0]["name"], b["hit"][0]["teamId"]), ("Sixer", 147))
check("最後一場的日期", b["hit"][0]["last"], "2026-08-06")

group("兩個榜：太久沒出賽就不算還在延續中")
# 進 IL 的人技術上沒有斷，但「今天誰手感燙」的榜上不該有傷兵
check("差 3 天還在（邊界含進去）",
      len(hitstreaks.boards(six, {}, date(2026, 8, 9))["hit"]), 1)
check("差 4 天就下榜", hitstreaks.boards(six, {}, date(2026, 8, 10))["hit"], [])

group("兩個榜：排序是場次多到少，同分比期間成績")
b = hitstreaks.boards(multi_cache({
    "1": ("SixOne", [(d, 4, 1, 4, 1) for d in days(6)]),
    "2": ("SixTwo", [(d, 4, 2, 4, 2) for d in days(6)]),
    "3": ("Seven", [(d, 4, 1, 4, 1) for d in days(7)]),
}), {}, date(2026, 8, 7))
check("場次多的在前", [r["name"] for r in b["hit"]], ["Seven", "SixTwo", "SixOne"])
check("七場那個是 7", b["hit"][0]["games"], 7)
check("同樣六場，安打多的排前面", b["hit"][1]["hits"], 12)

# ---------------------------------------------------------------------------
# 窗只有 14 天，一段 35 場的連續上壘在窗內看起來只有 12 場。
# 這幾條測的是「往前補」那條路徑。
# ---------------------------------------------------------------------------

D = days(20, date(2026, 7, 22))          # 07-22 ~ 08-10
WINDOW = D[-6:]                          # 快取只留最後六場
CACHE = multi_cache({"9": ("Streaker", [(d, 4, 1, 4, 1) for d in WINDOW])})
SEASON = [(d, 4, 1, 4, 1, 0) for d in D]

group("整季逐場：補完之後是 20 場不是 6 場")
b = hitstreaks.boards(CACHE, {9: log_rows(SEASON)}, date(2026, 8, 11))
check("連續安打 20 場", b["hit"][0]["games"], 20)
check("連續上壘 20 場（這下過門檻了）", b["onBase"][0]["games"], 20)
check("起算日是整季那段的第一場", b["hit"][0]["since"], "2026-07-22")
# 26 表示窗內那六場被算了兩次——兩份資料混著加就會長這樣
check("沒有把窗內那六場重複算成 26", b["hit"][0]["games"] != 26, True)
check("名字仍以快取最後一場為準（季中交易要跟著換隊）", b["hit"][0]["name"], "Streaker")

group("整季逐場：打到一半的比賽要擋掉")
"""
gameLog 打到一半就看得到當下的數字。一個 0 安 2 打數的第五局會讓
一段 20 場的連續安打當場歸零，下一個打席安打了又跳回來。
更糟的是同一個榜上會有兩套標準——沒補整季的人是從快取來的，而快取只收 Final。
擋法是拿快取的 gamePk 當「窗裡哪些已經打完」的名單。
"""
live = log_rows(SEASON) + [
    {"date": "2026-08-11", "gameType": "R", "game": {"gamePk": "live-not-in-cache"},
     "stat": {"atBats": 2, "hits": 0, "plateAppearances": 2,
              "baseOnBalls": 0, "hitByPitch": 0}}
]
b = hitstreaks.boards(CACHE, {9: live}, date(2026, 8, 11))
check("進行中的那場沒有把連續砍掉", b["hit"][0]["games"], 20)

group("整季逐場：只算例行賽")
# 季初春訓的比賽混進來的話，連續場次會從二月開始數
spring = log_rows([("2026-03-05", 4, 0, 4, 0, 0)], kind="S") + log_rows(SEASON)
b = hitstreaks.boards(CACHE, {9: spring}, date(2026, 8, 11))
check("春訓那場 0 安沒有中斷例行賽的連續", b["hit"][0]["games"], 20)

group("整季逐場：沒補到的人用窗內的答案")
# logs 有東西但不含這個人 → 不能因此把他整個弄丟
b = hitstreaks.boards(CACHE, {12345: log_rows(SEASON)}, date(2026, 8, 11))
check("退回窗內的 6 場", b["hit"][0]["games"], 6)

group("整季逐場：高飛犧牲打那一欄真的有讀到")
"""
這條守的是 statsapi.game_logs 的 fields 清單。sacFlies 沒列進去的話
API 會把整欄拿掉，而拿掉的結果是「所有比賽都沒有高飛犧牲打」——
不會報錯，只會安靜地把規則 9.23(b) 退回成錯的那版。
兩份資料只差 08-01 那場的最後一欄，答案差 10 場。
"""
mid = D[10]  # 08-01，窗（08-05 起）前面的那段
broke_it = [(d, 0, 0, 3, 2, 0, 1) if d == mid else (d, 4, 1, 4, 1, 0) for d in D]
skipped = [(d, 0, 0, 3, 2, 0, 0) if d == mid else (d, 4, 1, 4, 1, 0) for d in D]
b = hitstreaks.boards(CACHE, {9: log_rows(broke_it)}, date(2026, 8, 11))
check("有高飛犧牲打就斷在那裡，只剩 9 場", b["hit"][0]["games"], 9)
check("起算日是斷點的下一場", b["hit"][0]["since"], D[11])
b = hitstreaks.boards(CACHE, {9: log_rows(skipped)}, date(2026, 8, 11))
check("同一場沒有高飛犧牲打就整場跳過，19 場", b["hit"][0]["games"], 19)
# 那場有兩次上壘，連續上壘不受影響，20 場都在
check("連續上壘兩種情形都是 20 場", b["onBase"][0]["games"], 20)

group("快取那條路也要帶得動高飛犧牲打")
# 上一組走的是整季逐場。這組走窗內快取，兩條路都要照同一條規則。
sf_cache = multi_cache({"9": ("SacFly", [
    (days(8)[0], 4, 1, 4, 1),
    (days(8)[1], 0, 0, 3, 2, 1),      # 四壞兩次＋高飛犧牲打，打數 0
] + [(d, 4, 1, 4, 1) for d in days(8)[2:]])})
b = hitstreaks.boards(sf_cache, {}, date(2026, 8, 8))
# 沒把 sf 帶進來的話那場會被跳過，答案會是 7 而不是 6
check("斷在第二場，之後 6 場", b["hit"][0]["games"], 6)
# 那場兩次四壞是實實在在的上壘，連續上壘沒斷 → 他仍然是候選人。
# 候選的條件是「有一個榜沒斷」，不是「兩個榜都沒斷」。
check("連續上壘沒斷，所以還是候選人", 9 in hitstreaks.candidates(sf_cache), True)

group("兩個榜：空快取不要炸掉")
check("沒有 games", hitstreaks.boards({}, {}, TODAY), {"hit": [], "onBase": []})
check("games 是空的", hitstreaks.boards({"games": {}}, {}, TODAY), {"hit": [], "onBase": []})
check("沒有候選人", hitstreaks.candidates({}), set())

group("兩個榜：場次不可能多於安打（上壘）")
# 每一場都要有安打才算連續，所以總數一定 >= 場次。
# 這條破了表示欄位串了或接縫重複算，fetch 的健檢也守同一條。
allb = hitstreaks.boards(CACHE, {9: log_rows(SEASON)}, date(2026, 8, 11))
check("連續安打", [r for r in allb["hit"] if r["hits"] < r["games"]], [])
check("連續上壘", [r for r in allb["onBase"] if r["onBase"] < r["games"]], [])

print("\n%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
