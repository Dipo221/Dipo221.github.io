# -*- coding: utf-8 -*-
"""
進入點：抓 → 組 → 健檢 → 寫檔。

跑法：python scripts/mlb/fetch.py

輸出三個檔，全部是機器產生的，不要手改：
  tools/mlb/data.json               前端主要讀的
  tools/mlb/players.json            全聯盟 40 人名單索引（守備位置、球隊）
  tools/mlb/data/hardhit-cache.json 增量快取，不進版控

球員索引獨立成一個檔而不是塞進 data.json，是因為 data.json 每小時比對、
一有變動就 commit；索引約 40KB，混進去會讓每個 commit 都胖一截。

設計上是無狀態的：除了強擊球快取（純粹是省流量），每輪都從 API 重新推導。
整季 transactions 一次抓只要 3.8 秒，比維護增量狀態檔簡單，而且能自我修復。
"""

import json
import os
import sys
from datetime import date, datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import feeds  # noqa: E402
import hardhit  # noqa: E402
import parse  # noqa: E402
import statsapi  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(HERE))
OUT_PATH = os.path.join(ROOT, "tools", "mlb", "data.json")
PLAYERS_PATH = os.path.join(ROOT, "tools", "mlb", "players.json")
CACHE_PATH = os.path.join(ROOT, "tools", "mlb", "data", "hardhit-cache.json")

MOVE_DAYS = 7        # 傷兵異動看近 7 天
HARDHIT_DAYS = 14    # 強擊球與成績排行看近 14 天
CALLUP_DAYS = 14     # 新秀登板看近 14 天

# IL 相關的名單狀態碼（roster 快照用）
IL_CODES = ("D7", "D10", "D15", "D60")


def log(msg):
    print(msg, flush=True)


def iso(d):
    return d.isoformat() if d else None


def build(today=None):
    api = statsapi
    today = today or date.today()
    season = today.year

    log("MLB 追蹤器：開始（%s）" % today)

    log("  球隊…")
    teams = api.teams()

    log("  戰績與連勝連敗…")
    standings = api.standings(season)

    log("  整季異動…")
    season_start = date(season, 2, 1)
    txs = api.transactions(iso(season_start), iso(today))
    log("    %d 筆" % len(txs))

    # ---- IL 期間索引：球員 -> 最近一次「進入 IL」的起算日與傷勢 ----
    # roster 快照只說「現在在 IL」，不說「什麼時候進去的」，
    # 沒有起算日就算不出最快可回歸日，所以要靠異動記錄補。
    il_start = {}
    moves = []
    move_cutoff = today - timedelta(days=MOVE_DAYS)

    # 依日期由舊到新處理，這樣「進 IL → 啟動 → 又進 IL」才會留下最後那一次。
    # API 目前就是照日期排的，但不要靠它的順序，自己排一次比較保險。
    for t in sorted(txs, key=lambda x: x.get("date") or ""):
        if t.get("typeCode") != "SC":
            continue
        m = parse.parse_move(t.get("description"), t.get("date"))
        if not m:
            continue
        pid = (t.get("person") or {}).get("id")
        if not pid:
            continue

        if m["list_kind"] == "injured":
            if m["action"] in ("placed", "transferred"):
                il_start[pid] = {
                    "start": m["start_date"],
                    "days": m["days"],
                    "injury": m["injury"],
                }
            elif m["action"] == "activated":
                il_start.pop(pid, None)

        tx_date = parse.parse_iso(t.get("date"))
        if tx_date and tx_date >= move_cutoff:
            earliest = (
                parse.earliest_return(m["start_date"], m["days"])
                if m["action"] in ("placed", "transferred")
                else None
            )
            moves.append(
                {
                    "date": iso(tx_date),
                    "playerId": pid,
                    "name": (t.get("person") or {}).get("fullName", ""),
                    "teamId": (t.get("toTeam") or t.get("fromTeam") or {}).get("id"),
                    "action": m["action"],
                    "listKind": m["list_kind"],
                    "days": m["days"],
                    "injury": m["injury"],
                    "startDate": iso(m["start_date"]),
                    "earliestReturn": iso(earliest),
                    "description": t.get("description", ""),
                }
            )

    moves.sort(key=lambda x: x["date"], reverse=True)
    log("    近 %d 天名單異動 %d 筆" % (MOVE_DAYS, len(moves)))

    # ---- 目前傷兵名單：以 roster 快照為準 ----
    # 同一趟順便把每一隊的全部球員留下來當索引。前端的打者／投手篩選、
    # 我的球員的搜尋、強擊球卡上的守備位置都要用，而這裡本來就已經走過每個人了，
    # 一個額外的請求都不用發。
    log("  30 隊名單…")
    il_board = []
    players = []
    for team_id in sorted(teams):
        for p in api.roster(team_id):
            person = p.get("person") or {}
            pid = person.get("id")
            if not pid:
                continue
            players.append(
                [pid, person.get("fullName", ""),
                 (p.get("position") or {}).get("abbreviation", ""), team_id]
            )

            code = (p.get("status") or {}).get("code", "")
            if code not in IL_CODES:
                continue
            hist = il_start.get(pid) or {}
            start = hist.get("start")
            days = hist.get("days")
            earliest = parse.earliest_return(start, days)
            il_board.append(
                {
                    "playerId": pid,
                    "name": person.get("fullName", ""),
                    "pos": (p.get("position") or {}).get("abbreviation", ""),
                    "teamId": team_id,
                    "status": code,
                    "statusDesc": (p.get("status") or {}).get("description", ""),
                    # roster 的 note 是最即時的傷勢，沒有才退回異動記錄裡的
                    "injury": (p.get("note") or "").strip() or hist.get("injury"),
                    "startDate": iso(start),
                    "earliestReturn": iso(earliest),
                    "daysUntil": parse.days_until(earliest, today),
                }
            )

    il_board.sort(key=lambda x: (x["earliestReturn"] is None, x["earliestReturn"] or ""))
    log("    目前傷兵 %d 人，球員索引 %d 人" % (len(il_board), len(players)))

    # ---- 強擊球與 barrel（增量）----
    # 快取抓的是最長的那個窗（14 天），三個榜都從同一份快取算，不用多抓任何一場。
    log("  強擊球與 barrel…")
    hh_start = today - timedelta(days=HARDHIT_DAYS)
    games = api.schedule(iso(hh_start), iso(today))
    cache = hardhit.load_cache(CACHE_PATH)
    fetched = hardhit.refresh(api, games, cache, log=log)
    hardhit.save_cache(CACHE_PATH, cache)
    hard_hits = hardhit.boards(cache, today, "hh")
    barrels = hardhit.boards(cache, today, "br")
    log("    強擊球 %s，barrel %s（這輪抓了 %d 場）"
        % ("／".join("%s %d 人" % (k, len(v)) for k, v in sorted(hard_hits.items())),
           "／".join("%s %d 人" % (k, len(v)) for k, v in sorted(barrels.items())),
           fetched))

    # ---- 成績排行（次要視圖）----
    log("  近期成績排行…")
    hot = []
    for split in api.date_range_leaders("hitting", iso(hh_start), iso(today), "homeRuns", 25):
        st = split.get("stat", {})
        hot.append(
            {
                "playerId": split.get("player", {}).get("id"),
                "name": split.get("player", {}).get("fullName", ""),
                "teamId": split.get("team", {}).get("id"),
                "hr": st.get("homeRuns"),
                "avg": st.get("avg"),
                "ops": st.get("ops"),
                "rbi": st.get("rbi"),
            }
        )

    # ---- 新秀登板 ----
    log("  新秀登板…")
    callup_cutoff = today - timedelta(days=CALLUP_DAYS)
    raw_callups = []
    for t in txs:
        if t.get("typeCode") not in ("CU", "SE"):
            continue
        tx_date = parse.parse_iso(t.get("date"))
        if not tx_date or tx_date < callup_cutoff:
            continue
        pid = (t.get("person") or {}).get("id")
        if not pid:
            continue
        raw_callups.append((pid, tx_date, t))

    debut_info = api.people({pid for pid, _, _ in raw_callups}) if raw_callups else {}
    callups = []
    for pid, tx_date, t in raw_callups:
        person = debut_info.get(pid, {})
        debut = parse.parse_iso(person.get("mlbDebutDate"))
        # 初登板日就在這次異動前後 → 這是真的第一次上大聯盟
        is_debut = bool(debut and abs((debut - tx_date).days) <= 3)
        callups.append(
            {
                "playerId": pid,
                "name": (t.get("person") or {}).get("fullName", ""),
                "pos": (person.get("primaryPosition") or {}).get("abbreviation", ""),
                "teamId": (t.get("toTeam") or {}).get("id"),
                "date": iso(tx_date),
                "type": t.get("typeCode"),
                "typeDesc": t.get("typeDesc"),
                "debutDate": person.get("mlbDebutDate"),
                "isDebut": is_debut,
                "age": person.get("currentAge"),
            }
        )

    # 先照日期新到舊，再靠穩定排序把初登板頂到最前、其次是合約被選上
    #（SE 是被加進 40 人名單，比例行升降的 CU 重要）
    callups.sort(key=lambda c: c["date"], reverse=True)
    callups.sort(key=lambda c: (not c["isDebut"], c["type"] != "SE"))
    log("    近 %d 天 %d 筆，其中初登板 %d 人"
        % (CALLUP_DAYS, len(callups), sum(1 for c in callups if c["isDebut"])))

    # ---- 新聞 ----
    log("  新聞…")
    news = feeds.collect(days=CALLUP_DAYS, log=log)
    log("    共 %d 篇" % len(news))

    wins = sorted(
        [s for s in standings if s["type"] == "wins" and s["n"] >= 2],
        key=lambda s: -s["n"],
    )[:8]
    losses = sorted(
        [s for s in standings if s["type"] == "losses" and s["n"] >= 2],
        key=lambda s: -s["n"],
    )[:8]

    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

    payload = {
        "generatedAt": now,
        "season": season,
        "windows": {"moves": MOVE_DAYS, "hardHit": HARDHIT_DAYS, "callups": CALLUP_DAYS},
        "teams": [teams[k] for k in sorted(teams)],
        "ilMoves": moves,
        "ilBoard": il_board,
        "hardHits": hard_hits,
        "barrels": barrels,
        "hotStats": hot,
        "callups": callups,
        "streaks": {"wins": wins, "losses": losses},
        "news": news,
        "source": {
            "name": "MLB Stats API",
            "url": "https://statsapi.mlb.com/",
            "copyright": statsapi.COPYRIGHT_URL,
        },
    }

    # 用陣列不用物件是為了體積：1200 人差了將近 30KB，而 fields 就在檔案裡寫著，
    # 打開來看還是知道每一欄是什麼。
    players_payload = {
        "generatedAt": now,
        "fields": ["id", "name", "pos", "teamId"],
        "players": sorted(players, key=lambda r: r[0]),
    }

    return payload, players_payload


def health_check(payload, players_payload):
    """
    寫檔前的健檢。API 掛掉或改格式時，寧可整輪失敗保留上一份好資料，
    也不要 commit 一份半空的檔案上去把畫面洗掉。
    """
    problems = []
    if len(payload.get("teams", [])) != 30:
        problems.append("球隊數不是 30（%d）" % len(payload.get("teams", [])))
    if not payload.get("streaks", {}).get("wins") and not payload.get("streaks", {}).get("losses"):
        problems.append("連勝連敗兩邊都空的")

    # 30 隊各 40 人，扣掉空缺怎麼樣都有 1000 以上。少於這個數字表示
    # roster 迴圈中間有隊失敗了，索引缺一塊會讓前端的位置篩選悄悄漏人。
    n_players = len(players_payload.get("players", []))
    if n_players < 1000:
        problems.append("球員索引只有 %d 人，太少了" % n_players)

    # 球季中傷兵一定不會少於 50 人；季外沒有比賽就不強制
    month = int(payload["generatedAt"][5:7])
    in_season = 4 <= month <= 10
    if in_season and len(payload.get("ilBoard", [])) < 50:
        problems.append("球季中傷兵只有 %d 人，太少了" % len(payload.get("ilBoard", [])))
    # 球季中 14 天窗一定有人上榜；空的表示快取壞了或 playByPlay 全數失敗
    if in_season and not payload.get("hardHits", {}).get("d14"):
        problems.append("球季中強擊球 14 天榜是空的")
    return problems


def stable_view(payload):
    """
    去掉每輪都會變的欄位，用來判斷「內容有沒有真的變」。
    沒有這個判斷的話每小時都會產生一個空 commit，一年近 9000 個。
    """
    clone = dict(payload)
    clone.pop("generatedAt", None)
    return json.dumps(clone, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def write_if_changed(path, payload):
    """
    內容有變才寫。兩個檔各自比對——球員索引通常整天不動，
    沒必要跟著每小時都在變的 data.json 一起被重寫。
    """
    name = os.path.relpath(path, ROOT)
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                old = json.load(f)
            if stable_view(old) == stable_view(payload):
                log("  %s 沒變" % name)
                return False
        except (ValueError, OSError):
            pass  # 讀不動就當它需要重寫

    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, path)
    log("  寫入 %s（%.1f KB）" % (name, os.path.getsize(path) / 1024.0))
    return True


def main():
    payload, players_payload = build()

    problems = health_check(payload, players_payload)
    if problems:
        log("\n健檢沒過，這輪不寫檔：")
        for p in problems:
            log("  - " + p)
        return 1

    log("")
    wrote = write_if_changed(OUT_PATH, payload)
    wrote |= write_if_changed(PLAYERS_PATH, players_payload)
    if not wrote:
        log("  兩個檔都跟上一輪一樣（避免空 commit）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
