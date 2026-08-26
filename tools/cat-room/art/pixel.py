"""像素圖工具：字元地圖 -> spritesheet PNG + 校對圖 + lint。

    python pixel.py

這支是開發用的，不是網站的一部分——網站吃的是它吐出來的 PNG，
不用 node、不用 build step、不進任何頁面。要跑它才需要 Pillow。

為什麼存在
----------

畫的人（Claude）看不見自己畫的東西，是靠推座標把像素排出來的。
沒有回看的手段，錯的地方要等人類指出來才知道，一輪要花好幾分鐘。
所以這支的重點不是「輸出素材」，是輸出一張**看得懂的校對圖**：
放大 20 倍、加格線、加座標尺，才有辦法講出「(5,5) 那格拿掉」而不是「眼睛怪怪的」。

三種輸出各有用途：
    disi-16.png   1x 的正式素材，sprites.js 吃這張
    proof.png     20x + 格線 + 座標，抓單格錯誤用
    squint.png    4x 並排，抓剪影——縮小之後還認得出是貓才算過

lint 抓的是機械錯誤（行長不齊、色盤外的字元、孤兒像素、幀間差異過大），
不是美感。美感只能靠看。
"""
import os
import sys

try:
    from PIL import Image, ImageDraw
except ImportError:
    sys.exit("need Pillow:  pip install Pillow")

import disi

HERE = os.path.dirname(os.path.abspath(__file__))
PAL = disi.PALETTE
SHEET = disi.SHEET
BG = (28, 31, 41)


def rgb(ch):
    return PAL[ch]


def blit(img, rows, ox, oy, scale):
    d = ImageDraw.Draw(img)
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            x0, y0 = ox + x * scale, oy + y * scale
            d.rectangle([x0, y0, x0 + scale - 1, y0 + scale - 1], fill=rgb(ch))


def sequences():
    """實際會播出來的每一段：(動作名, 幀名列表, 毫秒)。

    照播放順序展開，不是照 sheet 上的排列順序——sprites.js 的 frames 陣列
    可以重複取同一格（walk 就是 0-1-2-1），也可以兩個動作共用同一排
    （walk 與 run 共用第 1 排）。量抖動、輸出 GIF 都要照播的順序。
    """
    out = []
    for name, spec in getattr(disi, "PLAY", {}).items():
        row = SHEET[spec["row"]]
        out.append((name, [row[i] for i in spec["frames"]], spec["ms"]))
    return out


def frames():
    """按 manifest 的順序攤平成 9 格：3 排 x 3 欄。"""
    out = []
    for row in SHEET:
        for name in row:
            out.append((name, disi.FRAMES[name]))
    return out


def build_sheet():
    img = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
    for i, (_, rows) in enumerate(frames()):
        blit(img, rows, (i % 3) * 16, (i // 3) * 16, 1)
    img.save(os.path.join(HERE, "disi-16.png"))


def build_proof(scale=20, pad=22):
    cell = 16 * scale + pad
    img = Image.new("RGB", (cell * 3 + pad, cell * 3 + pad), BG)
    d = ImageDraw.Draw(img)
    for i, (name, rows) in enumerate(frames()):
        ox = pad + (i % 3) * cell
        oy = pad + (i // 3) * cell
        d.rectangle([ox, oy, ox + 16 * scale, oy + 16 * scale], fill=(58, 62, 78))
        blit(img, rows, ox, oy, scale)
        for k in range(17):
            d.line([(ox + k * scale, oy), (ox + k * scale, oy + 16 * scale)],
                   fill=(96, 100, 118))
            d.line([(ox, oy + k * scale), (ox + 16 * scale, oy + k * scale)],
                   fill=(96, 100, 118))
        for k in range(0, 16, 2):
            d.text((ox + k * scale + 4, oy - 13), str(k), fill=(150, 156, 172))
            d.text((ox - 14, oy + k * scale + 4), str(k), fill=(150, 156, 172))
        d.text((ox + 2, oy + 16 * scale + 4), name, fill=(190, 195, 208))
    img.save(os.path.join(HERE, "proof.png"))


def build_squint(scale=4, gap=6):
    fs = frames()
    w = len(fs) * (16 * scale + gap) + gap
    img = Image.new("RGB", (w, 16 * scale + gap * 2), BG)
    for i, (_, rows) in enumerate(fs):
        blit(img, rows, gap + i * (16 * scale + gap), gap, scale)
    img.save(os.path.join(HERE, "squint.png"))


def build_anim(scale=8):
    """每個動作各存一支 GIF，用它在遊戲裡真正的幀速。

    單幀看起來對、播起來會抖，是這種尺寸最常見的坑——一格的錯位靜圖上
    找不到，動起來一眼就看到。速度要照真的，用隨手挑的秒數看順了沒有意義。
    """
    for name, seq, ms in sequences():
        imgs = []
        for fname in seq:
            im = Image.new("RGB", (16 * scale, 16 * scale), BG)
            blit(im, disi.FRAMES[fname], 0, 0, scale)
            imgs.append(im)
        imgs[0].save(os.path.join(HERE, "%s.gif" % name),
                     save_all=True, append_images=imgs[1:],
                     duration=ms, loop=0)


def check_rigid_head():
    """頭只能整塊平移，不能變形。

    比對的方式是把每一幀的頭切出來，去跟該組第一幀的頭比——
    只要能在某個垂直位移上完全吻合就算過。吻合不了就是有格子被改掉，
    報出位移量與差異格數，讓人知道往哪裡看。
    """
    r0, r1 = getattr(disi, "RIGID_ROWS", (0, 0))
    c0, c1 = getattr(disi, "RIGID_COLS", (0, 0))
    anims = getattr(disi, "RIGID_ANIMS", ())
    if r1 <= r0:
        return []

    def head(rows, off):
        if off < 0 or r1 + off > len(rows):
            return None
        return [r[c0:c1] for r in rows[r0 + off:r1 + off]]

    out = []
    for row in SHEET:
        if row[0][:-1] not in anims:
            continue
        ref = head(disi.FRAMES[row[0]], 0)
        for name in row[1:]:
            f = disi.FRAMES[name]
            hits = [o for o in range(-2, 3) if head(f, o) == ref]
            if hits:
                out.append("head %s: rigid, offset %+d" % (name, hits[0]))
                continue
            best, bd = 0, 10 ** 6
            for o in range(-2, 3):
                h = head(f, o)
                if h is None:
                    continue
                d = sum(1 for y in range(len(ref)) for x in range(len(ref[0]))
                        if h[y][x] != ref[y][x])
                if d < bd:
                    best, bd = o, d
            out.append("head %s: DEFORMED, %d px off at best offset %+d"
                       % (name, bd, best))
    return out


def lint():
    msgs = []
    for name, rows in disi.FRAMES.items():
        if len(rows) != 16:
            msgs.append("%s: %d rows, want 16" % (name, len(rows)))
        for y, r in enumerate(rows):
            if len(r) != 16:
                msgs.append("%s row %d: %d chars, want 16 -> %r" % (name, y, len(r), r))
            bad = set(r) - set(PAL) - {"."}
            if bad:
                msgs.append("%s row %d: not in palette: %s" % (name, y, "".join(sorted(bad))))

        def at(x, y):
            if 0 <= y < len(rows) and 0 <= x < len(rows[y]):
                return rows[y][x]
            return "."

        for y in range(len(rows)):
            for x in range(len(rows[y])):
                if at(x, y) == "." or len(rows[y]) != 16:
                    continue
                if all(at(*p) == "." for p in
                       [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]):
                    msgs.append("%s: orphan pixel at (%d,%d)" % (name, x, y))

    # 量相鄰兩幀，不是每幀對第 0 幀——會不會抖取決於播放時前後兩張的落差。
    # 而且動畫是 loop 的，最後一幀接回第一幀那一段同樣要量，
    # 不然接縫處的跳動剛好是唯一漏掉的那個。
    shifted = getattr(disi, "SHIFTED", ())
    for anim, seq, ms in sequences():
        for i, name in enumerate(seq):
            prev = seq[i - 1]
            a, b = disi.FRAMES[prev], disi.FRAMES[name]
            if any(len(r) != 16 for r in a + b):
                continue
            diff = sum(1 for y in range(16) for x in range(16) if a[y][x] != b[y][x])
            if name in shifted or prev in shifted:
                tag = "   (deliberate shift)"
            else:
                tag = "" if diff <= 24 else "   <- large, frames may jitter"
            msgs.append("%-5s %s -> %s: %d px%s" % (anim, prev, name, diff, tag))

    msgs += check_rigid_head()

    used = set()
    for rows in disi.FRAMES.values():
        for r in rows:
            used |= set(r)
    used -= {"."}
    unused = set(PAL) - used
    msgs.append("palette: %d defined, %d used%s" % (
        len(PAL), len(used), (", unused: " + "".join(sorted(unused))) if unused else ""))
    return msgs


if __name__ == "__main__":
    problems = lint()
    print("\n".join(problems))
    if any(("want 16" in m or "not in palette" in m) for m in problems):
        sys.exit("\nfix the map first, nothing rendered")
    build_sheet()
    build_proof()
    build_squint()
    build_anim()
    gifs = " ".join("%s.gif" % n for n, _, _ in sequences())
    print("\nwrote disi-16.png / proof.png / squint.png / " + gifs)
