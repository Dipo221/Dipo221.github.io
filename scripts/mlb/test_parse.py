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

print("\n%d passed, %d failed" % (passed, failed))
sys.exit(1 if failed else 0)
