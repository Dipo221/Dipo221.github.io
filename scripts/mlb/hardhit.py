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

# 2：加了 barrel（要仰角）。升版會整份重建，不試著相容 v1。
CACHE_VERSION = 2
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


def summarize_game(pbp, home_id, away_id):
    """
    把一場的逐打席壓成「打者 -> 擊球數／強擊球數／barrel 數／最高初速／初速總和」。

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

            rec = batters.setdefault(
                str(pid),
                {
                    "name": batter.get("fullName", ""),
                    "teamId": team_id,
                    "bb": 0,      # 有初速紀錄的擊球數
                    "hh": 0,      # 強擊球數
                    "br": 0,      # barrel 數
                    "max": 0.0,   # 最高初速
                    "sum": 0.0,   # 初速總和，用來算平均
                },
            )
            rec["bb"] += 1
            rec["sum"] += speed
            if speed > rec["max"]:
                rec["max"] = speed
            if parse.is_hard_hit(speed):
                rec["hh"] += 1
            if parse.is_barrel(speed, angle):
                rec["br"] += 1

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


def leaderboard(cache, days, today, metric="hh", min_batted_balls=10, limit=30):
    """
    由快取算出某個時間窗的排行。metric 是 "hh"（強擊球）或 "br"（barrel）。

    主排序是「數量」而不是比率——使用者要看的是「最近頻繁打出強擊球的打者」，
    比率高但只打了 12 球的人不是他要找的。比率照算並顯示，當第二個判讀指標。

    兩種數字都會放進每一列，所以強擊球榜上也看得到他 barrel 了幾顆，反之亦然。

    日期比字串就好，不用 parse 成 date——ISO 格式的字典序就是時間序。
    """
    cutoff = (today - timedelta(days=days)).isoformat()

    agg = {}
    for game in cache.get("games", {}).values():
        if (game.get("date") or "") < cutoff:
            continue
        for pid, rec in game.get("batters", {}).items():
            a = agg.setdefault(
                pid,
                {"playerId": int(pid), "name": rec["name"], "teamId": rec["teamId"],
                 "bb": 0, "hh": 0, "br": 0, "max": 0.0, "sum": 0.0, "games": 0},
            )
            a["bb"] += rec["bb"]
            a["hh"] += rec["hh"]
            a["br"] += rec.get("br", 0)
            a["sum"] += rec["sum"]
            a["games"] += 1
            if rec["max"] > a["max"]:
                a["max"] = rec["max"]
            # 名字與球隊以最近一場為準（季中交易的話要跟著換隊）
            if rec.get("name"):
                a["name"] = rec["name"]
            a["teamId"] = rec["teamId"]

    rows = []
    for a in agg.values():
        if a["bb"] < min_batted_balls:
            continue
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
