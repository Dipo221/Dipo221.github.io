# -*- coding: utf-8 -*-
"""
RSS 抓取。硬資料（傷兵、名單、數據）全部來自 statsapi，
這裡只負責敘述性的部分：回歸時程的說法、新秀話題、誰最近很燙。

與 statsapi 的失敗處理不一樣：單一 feed 掛掉就跳過那一個，不要讓整輪失敗。
新聞是補充，傷兵資料才是主體，不能因為某個新聞站當機就整頁沒東西。

來源都實測過（2026-09-01）：
  MLBTR 主 feed 15 篇、Yahoo 50 篇（有 fantasy 專欄）、ESPN 17 篇、
  MLB.com 25 篇、FanGraphs 10 篇、CBS 36 篇。
  MLBTR 的傷兵分類 feed（/injuries/feed、/category/injuries/feed、/tag/injuries/feed）
  三種寫法全是 soft-404：回 200 但 0 筆，不要再試。
  RotoBaller 主 feed 是多運動混合（實測最新一篇是 NFL），不收。
"""

import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

USER_AGENT = "dipo221.github.io mlb-tracker (personal fantasy baseball dashboard)"
TIMEOUT = 25

ATOM = "{http://www.w3.org/2005/Atom}"

SOURCES = [
    ("MLB Trade Rumors", "https://www.mlbtraderumors.com/feed"),
    ("Yahoo", "https://sports.yahoo.com/mlb/rss.xml"),
    ("ESPN", "https://www.espn.com/espn/rss/mlb/news"),
    ("MLB.com", "https://www.mlb.com/feeds/news/rss.xml"),
    ("FanGraphs", "https://blogs.fangraphs.com/feed/"),
    ("CBS Sports", "https://www.cbssports.com/rss/headlines/mlb/"),
]


def _fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        return resp.read()


def _parse_date(text):
    """RFC 822（多數 RSS）與 ISO（Atom）都要吃。認不得就回 None。"""
    if not text:
        return None
    text = text.strip()
    try:
        dt = parsedate_to_datetime(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError, IndexError):
        pass
    try:
        cleaned = text.replace("Z", "+00:00")
        dt = datetime.fromisoformat(cleaned)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _items(root):
    """RSS 2.0 的 item 與 Atom 的 entry 都要支援。"""
    items = root.findall(".//item")
    if items:
        return items, False
    return root.findall(".//" + ATOM + "entry"), True


def _text(node, tag, atom):
    if atom:
        el = node.find(ATOM + tag)
    else:
        el = node.find(tag)
    # CBS 的 title 前後有一堆空白與換行，一律 strip
    return (el.text or "").strip() if el is not None and el.text else ""


def _link(node, atom):
    if atom:
        el = node.find(ATOM + "link")
        if el is not None:
            return (el.get("href") or "").strip()
        return ""
    el = node.find("link")
    return (el.text or "").strip() if el is not None and el.text else ""


def collect(days=14, per_source=25, log=print):
    """抓所有來源、去重、依時間排序，只留近 days 天。"""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)
    seen_links = set()
    seen_titles = set()
    out = []

    for name, url in SOURCES:
        try:
            raw = _fetch(url)
            root = ET.fromstring(raw)
            nodes, atom = _items(root)
        except (urllib.error.URLError, urllib.error.HTTPError, ET.ParseError, OSError) as err:
            # 單一來源失敗不影響其他來源，也不影響整輪
            log("  新聞：%s 抓不到，跳過（%s）" % (name, type(err).__name__))
            continue

        if not nodes:
            log("  新聞：%s 回了 0 筆，跳過" % name)
            continue

        kept = 0
        for node in nodes[:per_source]:
            title = _text(node, "title", atom)
            link = _link(node, atom)
            if not title or not link:
                continue

            raw_date = (
                _text(node, "pubDate", atom)
                or _text(node, "updated", atom)
                or _text(node, "published", atom)
            )
            dt = _parse_date(raw_date)
            if dt and dt < cutoff:
                continue

            key_title = title.lower()
            if link in seen_links or key_title in seen_titles:
                continue
            seen_links.add(link)
            seen_titles.add(key_title)

            out.append(
                {
                    "title": title,
                    "link": link,
                    "source": name,
                    "date": dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                    if dt
                    else None,
                }
            )
            kept += 1

        log("  新聞：%s %d 筆" % (name, kept))
        time.sleep(0.2)

    # 新的在前；沒有日期的一律排到最後，不要讓缺值的跑到第一篇
    out.sort(key=lambda x: (x["date"] is not None, x["date"] or ""), reverse=True)
    return out
