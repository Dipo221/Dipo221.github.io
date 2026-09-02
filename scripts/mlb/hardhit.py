# -*- coding: utf-8 -*-
"""
強擊球與 barrel 彙總。

資料來自 statsapi 的 playByPlay——每個打席的 playEvents 裡有 hitData，
含 launchSpeed / launchAngle / totalDistance，就是 Statcast 那套數字。

原本考慮 Baseball Savant，實測放棄：
  - leaderboard/statcast 的 startdate/enddate 被無聲忽略（加了日期範圍，
    球員的 attempts 仍然是整季的數字，跟不加一模一樣）
  - leaderboard/custom 的 ev95plus 等欄位回傳全空
  - 逐球 statcast_search CSV 七天要 17MB
既然 playByPlay 就有同一套數據，全案維持單一資料源。

成本控制靠快取：比賽一旦 Final 就不會再變，所以依 gamePk 存彙總後的數字，
永遠不重抓。實測單場 542KB、每天約 12 場，首次回填 14 天約 90MB，
之後每天約 6.4MB，多數整點是 0 場新賽事、幾乎免費。
快取只留彙總不留原始逐打席，體積很小；快取掉了下一輪會自己回填。

彙總是「每場每位打者」一筆，不是整個窗一筆——這樣同一份快取可以算出
近 3 / 7 / 14 天三個榜，不用為了換時間窗重抓任何一場。
"""

import json
import os
import time
from datetime import timedelta

import parse

# 2：加了 barrel（要仰角）。
# 3：加了選球（追打／揮空）與甜蜜點，而且開始逐球數而不是只數擊球。
# 升版會整份重建，不試著相容舊格式。
CACHE_VERSION = 3
REQUEST_GAP = 0.25  # 逐場請求之間的間隔，別把人家伺服器打太兇

# 每個時間窗的最低擊球數。一場大概 3.5 顆有初速紀錄的擊球，
# 所以門檻大約等於「至少要有 3 場 / 2 場 / 1 場的接觸」。
# 三個窗共用 10 的話，3 天榜首會是某個打了一球 100 mph、硬擊率 100% 的人。
WINDOWS = ((14, 10), (7, 6), (3, 3))


def load_cache(path):
    if not os.path.exists(path):
        return {"version": CACHE_VERSION, "games": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data.get("version") != CACHE_VERSION:
            # 格式改過就整個重建，不要試著相容舊格式
            return {"version": CACHE_VERSION, "games": {}}
        data.setdefault("games", {})
        return data
    except (ValueError, OSError):
        return {"version": CACHE_VERSION, "games": {}}


def save_cache(path, cache):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, path)


def _blank(name, team_id):
    return {
        "name": name,
        "teamId": team_id,
        # 接觸品質：球棒碰到球之後
        "bb": 0,      # 有初速紀錄的擊球數
        "hh": 0,      # 強擊球數
        "br": 0,      # barrel 數
        "ss": 0,      # 甜蜜點（仰角 8~32 度）
        "max": 0.0,   # 最高初速
        "sum": 0.0,   # 初速總和，用來算平均
        "la": 0.0,    # 仰角總和
        "lan": 0,     # 有仰角紀錄的擊球數，算平均仰角與甜蜜點率的分母
        # 選球：他決定要不要揮的那一瞬間
        "p": 0,       # 看了幾球
        "oz": 0,      # 其中幾球在好球帶外
        "ch": 0,      # 追打（揮了帶外的球）
        "sw": 0,      # 揮棒數
        "wh": 0,      # 揮空數
    }


def summarize_game(pbp, home_id, away_id):
    """
    把一場的逐打席壓成每位打者一筆，兩組數字：

      接觸品質  bb/hh/br/ss/max/sum/la/lan  球棒碰到球之後發生了什麼
      選球      p/oz/ch/sw/wh               他決定要不要揮的那一瞬間

    第二組是後來補的。原本只存接觸品質，等於只量「揮出去之後」，
    對「他有沒有在打該打的球」完全是瞎的——而打者手感掉下去的時候，
    最先壞的是選球（開始追壞球、開始揮空），結果是後來才崩的。

    兩組都從同一份 playByPlay 讀，沒有多打任何一個請求。

    打者屬於哪一隊靠 halfInning 判斷：上半局是客隊進攻。
    """
    batters = {}
    for play in pbp.get("allPlays", []):
        about = play.get("about", {})
        matchup = play.get("matchup", {})
        batter = matchup.get("batter") or {}
        pid = batter.get("id")
        if not pid:
            continue
        team_id = away_id if about.get("halfInning") == "top" else home_id

        for event in play.get("playEvents", []):
            """
            換投、牽制、暫停這些也在 playEvents 裡，不能進看球數的分母。
            舊版沒有這個判斷是因為它只找 hitData，而 hitData 只長在投球事件上；
            現在要算投球數了就得先擋掉。
            """
            if not event.get("isPitch"):
                continue

            rec = batters.setdefault(
                str(pid), _blank(batter.get("fullName", ""), team_id)
            )
            rec["p"] += 1

            details = event.get("details") or {}
            code = (details.get("call") or {}).get("code")
            swung = parse.is_swing(code)
            if swung:
                rec["sw"] += 1
                if parse.is_whiff(code):
                    rec["wh"] += 1

            """
            zone 缺值的球兩邊都不計。算成「帶內」會讓追打率的分母縮水，
            算成「帶外」則會稀釋它——兩種都是把不知道的事當成知道。
            """
            if parse.in_zone((event.get("pitchData") or {}).get("zone")) is False:
                rec["oz"] += 1
                if swung:
                    rec["ch"] += 1

            hit = event.get("hitData")
            if not hit:
                continue
            speed = hit.get("launchSpeed")
            if speed is None:
                continue
            try:
                speed = float(speed)
            except (TypeError, ValueError):
                continue
            # 仰角缺值不擋這顆球（初速還是要算進擊球數），只是不會被判成 barrel
            angle = hit.get("launchAngle")

            rec["bb"] += 1
            rec["sum"] += speed
            if speed > rec["max"]:
                rec["max"] = speed
            if parse.is_hard_hit(speed):
                rec["hh"] += 1
            if parse.is_barrel(speed, angle):
                rec["br"] += 1
            if parse.is_sweet_spot(angle):
                rec["ss"] += 1
            if angle is not None:
                try:
                    rec["la"] += float(angle)
                    rec["lan"] += 1
                except (TypeError, ValueError):
                    pass

    return batters


def refresh(api, games, cache, log=print):
    """
    只抓「已 Final 且不在快取裡」的場次，並剔除不在本次窗口內的舊場次。

    回傳這次實際抓了幾場，方便驗證增量有沒有生效。
    """
    wanted = {str(g["gamePk"]): g for g in games if g.get("state") == "Final"}

    # 先剔除窗口外的，快取才不會無限長大
    for pk in list(cache["games"].keys()):
        if pk not in wanted:
            del cache["games"][pk]

    todo = [pk for pk in wanted if pk not in cache["games"]]
    todo.sort()
    if todo:
        log("  強擊球：%d 場已 Final，其中 %d 場要抓" % (len(wanted), len(todo)))
    else:
        log("  強擊球：%d 場全部命中快取，不用抓" % len(wanted))

    for i, pk in enumerate(todo, 1):
        g = wanted[pk]
        pbp = api.play_by_play(int(pk))
        cache["games"][pk] = {
            "date": g["date"],
            "batters": summarize_game(pbp, g.get("home"), g.get("away")),
        }
        if i % 20 == 0 or i == len(todo):
            log("    %d/%d" % (i, len(todo)))
        if i < len(todo):
            time.sleep(REQUEST_GAP)

    return len(todo)


_SUMS = ("bb", "hh", "br", "ss", "lan", "p", "oz", "ch", "sw", "wh")


def aggregate(cache, since):
    """
    把 since 當天以後的場次彙總成「每位打者一筆」。

    日期比字串就好，不用 parse 成 date——ISO 格式的字典序就是時間序。
    """
    agg = {}
    for game in cache.get("games", {}).values():
        date = game.get("date") or ""
        if date < since:
            continue
        for pid, rec in game.get("batters", {}).items():
            a = agg.setdefault(
                pid,
                dict({"playerId": int(pid), "name": rec["name"], "teamId": rec["teamId"],
                      "max": 0.0, "sum": 0.0, "la": 0.0, "games": 0},
                     **{k: 0 for k in _SUMS}),
            )
            for k in _SUMS:
                a[k] += rec.get(k, 0)
            a["sum"] += rec["sum"]
            a["la"] += rec.get("la", 0.0)
            a["games"] += 1
            if rec["max"] > a["max"]:
                a["max"] = rec["max"]
            # 名字與球隊以最近一場為準（季中交易的話要跟著換隊）
            if rec.get("name"):
                a["name"] = rec["name"]
            a["teamId"] = rec["teamId"]
    return agg


"""
這裡曾經有一個 trend_map()：近 7 天 vs 第 8~14 天的硬擊率變化，
前端拿去畫「升溫／降溫」徽章。實測之後整個拿掉，理由留在這裡免得有人再做一次。

用過度離散檢定量「觀察到的差異裡有多少不是抽樣誤差」，同一套檢定三組對照：

    打者之間的硬擊率差異（已知是真的）      比值 1.69   ← 檢定抓得到訊號
    同一人的比賽隨機對切（已知沒有意義）    比值 1.01   ← 空跑的基準
    近 7 天 vs 前 7 天                      比值 1.05   ← 跟空跑分不出來

也就是說「這一週跟上一週的差別」和「把他的比賽隨機分成兩堆」是同一件事。
barrel 率 1.02、甜蜜點率 1.01、追打率 0.88、揮空率 1.13、平均初速 0.99，全部一樣。

扣掉雜訊後真實的週對週變化 SD 只有 3.8 個百分點，而徽章門檻設 0.08 的話
會有 61% 的卡片掛上徽章、上面寫著 ±8 到 ±40 個百分點。那是在報雜訊。

窗開大也救不了：要讓雜訊小於那 3.8 個百分點，每一段需要約 324 顆擊球，
大約是一整季。所以這個東西在任何短於整季的窗上都量不出來。
"""


def leaderboard(cache, days, today, metric="hh", min_batted_balls=10, limit=30):
    """
    由快取算出某個時間窗的排行。metric 是 "hh"（強擊球）或 "br"（barrel）。

    主排序是「數量」而不是比率——使用者要看的是「最近頻繁打出強擊球的打者」，
    比率高但只打了 12 球的人不是他要找的。比率照算並顯示，當第二個判讀指標。

    兩種數字都會放進每一列，所以強擊球榜上也看得到他 barrel 了幾顆，反之亦然。
    """
    agg = aggregate(cache, (today - timedelta(days=days)).isoformat())

    rows = []
    for a in agg.values():
        if a["bb"] < min_batted_balls:
            continue
        """
        選球的分母是「看了幾球」，跟擊球數是兩回事：
        一個打席可能看了六球才出局，也可能第一球就打掉。
        所以這裡不能拿 bb 當分母，帶外球數與揮棒數各自算各自的。
        """
        oz, sw, lan = a["oz"], a["sw"], a["lan"]
        rows.append(
            {
                "playerId": a["playerId"],
                "name": a["name"],
                "teamId": a["teamId"],
                "hardHits": a["hh"],
                "barrels": a["br"],
                "battedBalls": a["bb"],
                "hardHitRate": round(a["hh"] / a["bb"], 3) if a["bb"] else 0,
                "barrelRate": round(a["br"] / a["bb"], 3) if a["bb"] else 0,
                "maxEV": round(a["max"], 1),
                "avgEV": round(a["sum"] / a["bb"], 1) if a["bb"] else 0,
                "games": a["games"],
                # 甜蜜點補的是強擊球看不到的事：同樣 105 mph，滾地球跟平飛球差很多
                "sweetSpotRate": round(a["ss"] / lan, 3) if lan else None,
                "avgLA": round(a["la"] / lan, 1) if lan else None,
                "pitches": a["p"],
                "chaseRate": round(a["ch"] / oz, 3) if oz else None,
                "whiffRate": round(a["wh"] / sw, 3) if sw else None,
            }
        )

    count_key = "barrels" if metric == "br" else "hardHits"
    rate_key = "barrelRate" if metric == "br" else "hardHitRate"
    rows.sort(key=lambda r: (-r[count_key], -r[rate_key], -r["maxEV"]))

    # barrel 比強擊球稀有得多，短窗會有一整排 0。0 顆不是「排行」，砍掉。
    rows = [r for r in rows if r[count_key] > 0]
    return rows[:limit]


def boards(cache, today, metric="hh", limit=30):
    """三個時間窗一次算完，回傳 {"d14": [...], "d7": [...], "d3": [...]}。"""
    return {
        "d%d" % days: leaderboard(cache, days, today, metric, min_bb, limit)
        for days, min_bb in WINDOWS
    }
