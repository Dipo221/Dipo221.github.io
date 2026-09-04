# -*- coding: utf-8 -*-
"""
連續安打與連續上壘（現在還在延續中的那一段，不是本季最長紀錄）。

資料有兩個來源，順序是刻意的：

  1. 強擊球快取  每場每位打者的 ab/h/pa/ob，強擊球那邊本來就抓了 playByPlay，
                 這裡一個請求都沒有多打
  2. 整季逐場    只給「窗內從頭到尾沒中斷」的那些人補

為什麼要有第二步：快取只留最近 14 天，大約 12 到 13 場。一段 35 場的
連續上壘在窗內看起來就只有 12 場——那不是「資料少一點」，是印一個錯的數字
在畫面上。所以窗內就斷掉的人直接用窗內的答案（那已經是精確值），
只有一路數到窗頭還沒斷的人才需要往前問。

這個切法是量過的：實測 444 名打者裡只有 33 人需要補，一個批次請求就夠。
而且對「沒被列為候選的人，窗內答案是否等於整季答案」全部驗過，零筆不同——
會被漏掉的只有窗內一場都沒打的人，那種人本來就不符合「現役」。

連續安打照官方規則 9.23(b)，那條對兩種犧牲打的處理是相反的：
整場的打席全是四壞、觸身、妨礙打擊或「犧牲觸擊」的比賽不算中斷也不算延續，
整場跳過；但只要出現一次「高飛犧牲打」而且整場沒安打，連續安打就斷了。
兩者都不算打數，所以光看打數是 0 分不出來，要另外數高飛犧牲打。

連續上壘沒有官方定義，這條是自己訂的：有打席就算一場，沒上壘就斷。
上壘只認安打、四壞、觸身，失誤上壘與野手選擇不算。
"""

from datetime import timedelta

import parse

# 兩邊的門檻不一樣，因為基準率差很多。實測 384 名現役打者：
#
#            >=4 場   >=5 場   >=8 場   >=10 場
#   連續安打   43 人    16 人     4 人      1 人
#   連續上壘   92 人    62 人    28 人     17 人
#
# 上壘多了四壞跟觸身兩條路，本季最長是 35 場，連續安打最長才 12 場。
# 兩邊都用同一個數字的話，不是安打榜空著就是上壘榜擠進六十幾個人。
# 挑 5 與 10 是讓兩邊都落在 16~20 列：不會空，也不會滿到被 LIMIT 砍掉
# 而在同分的地方硬切一刀。
MIN_GAMES = {"hit": 5, "onBase": 10}

# 幾天沒出賽就不算「還在延續中」。
#
# 進 IL 的人技術上連續場次沒有斷，但那個數字對使用者沒有用——
# 他要的是「今天誰手感燙」。3 天是留給輪休與全隊休兵的餘裕，
# 再長就會把傷兵放進一個叫「現在正熱」的榜。
ACTIVE_DAYS = 3

LIMIT = 30


def _from_cache(cache):
    """快取 → {playerId: [每場一筆，由舊到新]}。"""
    per = {}
    for pk, game in cache.get("games", {}).items():
        day = game.get("date") or ""
        for pid, rec in game.get("batters", {}).items():
            per.setdefault(int(pid), []).append(
                {
                    "date": day,
                    # 同一天的雙重賽要分先後，只比日期會排不出來
                    "pk": pk,
                    "ab": rec.get("ab", 0),
                    "h": rec.get("h", 0),
                    "pa": rec.get("pa", 0),
                    "ob": rec.get("ob", 0),
                    "sf": rec.get("sf", 0),
                    "name": rec.get("name", ""),
                    "teamId": rec.get("teamId"),
                }
            )
    for rows in per.values():
        rows.sort(key=lambda r: (r["date"], r["pk"]))
    return per


def _from_log(splits, final_pks, since):
    """
    整季逐場 → 同一種形狀。

    只留例行賽：春訓與季後賽的場次也在同一份 gameLog 裡，
    混進去的話季初會把春訓的比賽算成連續場次。

    還要擋掉正在進行中的比賽。gameLog 打到一半就看得到當下的數字，
    一個 0 安 2 打數的第五局會讓一段 20 場的連續安打當場歸零，
    下一個打席安打了又跳回來。更糟的是同一個榜上會有兩套標準——
    沒補整季的人是從快取來的，而快取只收 Final。

    做法是拿快取的 gamePk 當「這個窗裡哪些已經打完」的名單：
    since 之後的場次一定要在名單上，更早的就不用查（那些必然已經 Final）。
    """
    rows = []
    for s in splits or []:
        if s.get("gameType") != "R":
            continue
        day = s.get("date") or ""
        if day >= since:
            pk = str(((s.get("game") or {}).get("gamePk")) or "")
            if pk not in final_pks:
                continue
        st = s.get("stat") or {}
        hits = st.get("hits", 0) or 0
        walks = st.get("baseOnBalls", 0) or 0
        hbp = st.get("hitByPitch", 0) or 0
        rows.append(
            {
                "date": day,
                "pk": "",
                "ab": st.get("atBats", 0) or 0,
                "h": hits,
                "pa": st.get("plateAppearances", 0) or 0,
                # gameLog 沒有現成的上壘次數欄位，自己加。
                # baseOnBalls 本來就含故意四壞，不要再把 intentionalWalks 加一次。
                "ob": hits + walks + hbp,
                "sf": st.get("sacFlies", 0) or 0,
            }
        )
    rows.sort(key=lambda r: r["date"])
    return rows


def run(lines, kind):
    """
    從最後一場往回數，回這一段連續場次。

    counts 是「這場算不算數」，good 是「算數而且有延續下去」——
    兩個要分開判斷，因為連續安打有第三種情形：整場沒有打數的比賽
    既不中斷也不延續，直接跳過去看再前面那場。少了這一條，
    一場只保送兩次的比賽會把 20 場的連續安打砍成 0。

    但「沒有打數」不等於「跳過」：規則 9.23(b) 把高飛犧牲打排除在那條
    豁免之外，有高飛犧牲打又沒安打的比賽會中斷連續安打。它跟犧牲觸擊
    一樣不算打數，所以 counts 不能只看打數，要 or 上高飛犧牲打——
    否則「四壞＋高飛犧牲打」那場會被當成整場沒上場一樣跳過去。

    broke=False 表示一路數到手上這份資料的第一場都還沒斷，
    也就是真正的連續場次可能比這裡看到的更長，要往前補。
    """
    games = 0
    since = None
    ab = h = pa = ob = 0
    broke = False

    for row in reversed(lines):
        if kind == "hit":
            counts = row["ab"] > 0 or row.get("sf", 0) > 0
        else:
            counts = row["pa"] > 0
        if not counts:
            continue
        good = row["h"] > 0 if kind == "hit" else row["ob"] > 0
        if not good:
            broke = True
            break
        games += 1
        since = row["date"]
        ab += row["ab"]
        h += row["h"]
        pa += row["pa"]
        ob += row["ob"]

    return {
        "games": games,
        "since": since,
        "ab": ab,
        "h": h,
        "pa": pa,
        "ob": ob,
        "broke": broke,
    }


def candidates(cache):
    """
    窗內從頭到尾沒中斷的人。他們的連續場次可能比窗還長，要拿整季逐場來補。

    不能只挑「窗內已經很長」的人：只出賽三場、三場都上壘的替補
    也可能是一段 20 場的連續上壘，他的窗內數字卻只有 3。
    判斷條件是「有沒有斷過」，不是「數字夠不夠大」。
    """
    out = set()
    for pid, lines in _from_cache(cache).items():
        for kind in ("hit", "onBase"):
            r = run(lines, kind)
            if r["games"] and not r["broke"]:
                out.add(pid)
                break
    return out


def boards(cache, logs, today):
    """
    兩個榜一起算，回 {"hit": [...], "onBase": [...]}。

    logs 是 statsapi.game_logs() 的結果（只有候選人在裡面），
    沒補到的人就用窗內的答案——那對他們來說已經是精確值。
    """
    out = {"hit": [], "onBase": []}
    cutoff = today - timedelta(days=ACTIVE_DAYS)

    """
    整季逐場那邊要靠這兩個值擋掉正在進行中的比賽，理由見 _from_log。

    final_pks 是快取裡的每一場，全部都是 Final（hardhit 只收打完的）。
    since 是窗的第一天：比它早的場次不必查，那些必然已經結束很久了。
    快取空的時候 since 用 "9999"，讓「day >= since」永遠不成立——
    這種情況下整份 logs 也不會有東西（候選人是從快取挑的），是防呆不是路徑。
    """
    games = cache.get("games", {})
    final_pks = set(str(pk) for pk in games)
    dates = [g.get("date") or "" for g in games.values()]
    since = min(dates) if dates else "9999"

    for pid, window in _from_cache(cache).items():
        # 補過的人整段改用整季逐場，兩份混著算會在接縫上重複計算場次
        log = _from_log(logs.get(pid), final_pks, since) if logs else None
        lines = log if log else window
        if not lines:
            continue

        last = parse.parse_iso(lines[-1]["date"])
        if not last or last < cutoff:
            continue

        # 名字與球隊以快取最後一場為準（季中交易要跟著換隊）
        latest = window[-1]

        for kind in ("hit", "onBase"):
            r = run(lines, kind)
            if r["games"] < MIN_GAMES[kind]:
                continue
            out[kind].append(
                {
                    "playerId": pid,
                    "name": latest["name"],
                    "teamId": latest["teamId"],
                    "games": r["games"],
                    "since": r["since"],
                    "last": lines[-1]["date"],
                    "ab": r["ab"],
                    "hits": r["h"],
                    "pa": r["pa"],
                    "onBase": r["ob"],
                }
            )

    """
    同分的時候比期間的成績，不是比名字。

    連續安打同樣 7 場，一場一支跟一場三支不是同一件事；
    連續上壘同樣 12 場也一樣。第三順位才是 playerId，
    純粹是為了讓同分同成績的兩個人每輪排出來的順序固定，
    不然 data.json 會因為排序不穩定而每小時都「有變動」，多出一堆空 commit。
    """
    for kind in ("hit", "onBase"):
        num = "hits" if kind == "hit" else "onBase"
        out[kind].sort(key=lambda r: (-r["games"], -r[num], r["playerId"]))
        out[kind] = out[kind][:LIMIT]

    return out
