# -*- coding: utf-8 -*-
"""
MLB Stats API 的薄封裝。只有 HTTP 與取值，不做商業邏輯。

statsapi.mlb.com 沒有官方文件也不需要 API key，是 MLB.com 自己網站背後打的同一組
endpoint。沒有公告的 rate limit，但既然是借用人家的服務就自己節制：
帶可辨識的 User-Agent、逐場請求之間留間隔、能快取的就不要重抓。

回應本身帶著 MLB Advanced Media 的著作權聲明（見 COPYRIGHT_URL），
前端 footer 要標示來源。
"""

import json
import time
import urllib.error
import urllib.parse
import urllib.request

BASE = "https://statsapi.mlb.com/api"
COPYRIGHT_URL = "http://gdx.mlb.com/components/copyright.txt"
USER_AGENT = "dipo221.github.io mlb-tracker (personal fantasy baseball dashboard)"

TIMEOUT = 30
RETRIES = 3
RETRY_WAIT = 2.0


def get(path, **params):
    """
    打一個 endpoint 回 dict。失敗會重試，重試完還是失敗就往上丟——
    抓不到資料時要讓整輪停掉、保留上一份好資料，不要默默回空的。
    """
    qs = "&".join(
        "%s=%s" % (k, urllib.parse.quote(str(v), safe=",|"))
        for k, v in params.items()
        if v is not None
    )
    url = BASE + path + ("?" + qs if qs else "")
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})

    last = None
    for attempt in range(RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except (urllib.error.URLError, urllib.error.HTTPError, ValueError, OSError) as err:
            last = err
            if attempt < RETRIES - 1:
                time.sleep(RETRY_WAIT * (attempt + 1))
    raise RuntimeError("statsapi 打不通：%s（%s）" % (url, last))


def teams():
    """30 隊。回 {teamId: {...}}。"""
    out = {}
    for t in get("/v1/teams", sportId=1).get("teams", []):
        league = t.get("league", {}).get("name", "")
        out[t["id"]] = {
            "id": t["id"],
            "abbr": t.get("abbreviation", ""),
            "name": t.get("name", ""),
            "short": t.get("teamName", ""),
            "league": "AL" if "American" in league else ("NL" if "National" in league else ""),
            "division": t.get("division", {}).get("name", ""),
        }
    return out


def standings(season):
    """
    連勝／連敗。leagueId 103=AL、104=NL，一次就拿到 30 隊。
    streak 長這樣：{"streakCode":"W5","streakType":"wins","streakNumber":5}
    """
    data = get(
        "/v1/standings", leagueId="103,104", season=season, standingsTypes="regularSeason"
    )
    rows = []
    for div in data.get("records", []):
        for t in div.get("teamRecords", []):
            streak = t.get("streak") or {}
            rows.append(
                {
                    "teamId": t["team"]["id"],
                    "wins": t.get("wins"),
                    "losses": t.get("losses"),
                    "code": streak.get("streakCode"),
                    "type": streak.get("streakType"),
                    "n": streak.get("streakNumber") or 0,
                }
            )
    return rows


def transactions(start, end):
    """區間內所有異動。整季一次抓實測 4.3MB / 3.8 秒。"""
    data = get("/v1/transactions", sportId=1, startDate=start, endDate=end)
    return data.get("transactions", [])


def roster(team_id):
    """
    40 人名單快照。狀態碼 A / RM / D10 / D15 / D60 / NYR，
    傷兵的 note 欄位放傷勢文字（覆蓋率約 8 成，缺的要有 fallback）。

    註：teams endpoint 上的 hydrate=roster(person) 會被無聲忽略，
    只能一隊一隊打，不要浪費時間再試 hydrate。
    """
    return get("/v1/teams/%d/roster" % team_id, rosterType="40Man").get("roster", [])


def schedule(start, end):
    """區間內的比賽，含 status.abstractGameState（Final / Preview / Live）。"""
    data = get("/v1/schedule", sportId=1, startDate=start, endDate=end)
    games = []
    for day in data.get("dates", []):
        for g in day.get("games", []):
            games.append(
                {
                    "gamePk": g["gamePk"],
                    "date": day["date"],
                    "state": g.get("status", {}).get("abstractGameState"),
                    "home": g.get("teams", {}).get("home", {}).get("team", {}).get("id"),
                    "away": g.get("teams", {}).get("away", {}).get("team", {}).get("id"),
                }
            )
    return games


def play_by_play(game_pk):
    """單場逐打席，每個打席的 playEvents 裡有 hitData（含 launchSpeed）。"""
    return get("/v1/game/%d/playByPlay" % game_pk)


def date_range_leaders(group, start, end, sort_stat, limit=25):
    """近 N 日的成績排行（結果導向，跟強擊球的過程導向互補）。"""
    data = get(
        "/v1/stats",
        stats="byDateRange",
        group=group,
        sportId=1,
        startDate=start,
        endDate=end,
        sortStat=sort_stat,
        limit=limit,
    )
    stats = data.get("stats") or []
    return stats[0].get("splits", []) if stats else []


def people(person_ids):
    """批次查球員，主要是要 mlbDebutDate 來判定是不是初登板。"""
    out = {}
    ids = list(person_ids)
    # URL 不要太長，分批打
    for i in range(0, len(ids), 40):
        chunk = ids[i : i + 40]
        if not chunk:
            continue
        data = get("/v1/people", personIds=",".join(str(x) for x in chunk))
        for p in data.get("people", []):
            out[p["id"]] = p
    return out
