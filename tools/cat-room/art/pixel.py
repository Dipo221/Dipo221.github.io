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
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("need Pillow:  pip install Pillow")

import disi
import room

HERE = os.path.dirname(os.path.abspath(__file__))
PAL = disi.PALETTE
SHEET = disi.SHEET
BG = (28, 31, 41)

# 格數從資料算，不寫死。之前寫死 3x3，加一排姿勢就要改三個地方，
# 而且漏掉的那個地方不會報錯——只會默默把新的一排畫到圖框外面。
COLS = len(SHEET[0])
ROWS = len(SHEET)


def rgb(ch):
    return PAL[ch]


def blit(img, rows, ox, oy, scale, pal=None):
    """把一張字元地圖畫上去。"." 是透明，直接跳過。

    pal 可以換，是因為房間有自己的一套色（room.PALETTE）。
    貓和房間**刻意不共用調色盤**——貓是暖的、房間是冷的，
    共用一份會逼著其中一邊妥協，而那個對比正是貓看得見的原因。
    """
    p = PAL if pal is None else pal
    d = ImageDraw.Draw(img)
    for y, rowdata in enumerate(rows):
        for x, ch in enumerate(rowdata):
            if ch == ".":
                continue
            x0, y0 = ox + x * scale, oy + y * scale
            d.rectangle([x0, y0, x0 + scale - 1, y0 + scale - 1], fill=p[ch])


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
    """按 manifest 的順序攤平：一排一個姿勢，由左至右。"""
    out = []
    for row in SHEET:
        for name in row:
            out.append((name, disi.FRAMES[name]))
    return out


def build_sheet():
    img = Image.new("RGBA", (16 * COLS, 16 * ROWS), (0, 0, 0, 0))
    for i, (_, rows) in enumerate(frames()):
        blit(img, rows, (i % COLS) * 16, (i // COLS) * 16, 1)
    img.save(os.path.join(HERE, "disi-16.png"))


def build_proof(scale=20, pad=22):
    cell = 16 * scale + pad
    img = Image.new("RGB", (cell * COLS + pad, cell * ROWS + pad), BG)
    d = ImageDraw.Draw(img)
    for i, (name, rows) in enumerate(frames()):
        ox = pad + (i % COLS) * cell
        oy = pad + (i // COLS) * cell
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
    """縮小並排，抓剪影用。

    排法跟 sheet 一樣一排一個姿勢，不是全部擠成一長條——
    要比的是「同一個姿勢的三格會不會抖」跟「這排跟那排認不認得出是兩件事」，
    攤成一條的話這兩件事都要用眼睛跨半張圖去對。
    """
    cell = 16 * scale + gap
    img = Image.new("RGB", (cell * COLS + gap, cell * ROWS + gap), BG)
    for i, (_, rows) in enumerate(frames()):
        blit(img, rows, gap + (i % COLS) * cell, gap + (i // COLS) * cell, scale)
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


# ---------------------------------------------------------------- 房間
#
# 房間跟貓共用這支的算圖器，但輸出的目的完全不同：
# 貓的校對圖是放大 20 倍找單格錯誤，房間的比較圖是**把三個尺寸擺在同一個
# 顯示寬度**，因為要決定的不是哪一格畫錯，是「貓在裡面會不會太小」。
# 那件事只能整張看，放大到 20 倍反而看不出來。


def room_font(size):
    """標籤只用 ASCII。

    Pillow 的內建點陣字沒有中文字模，塞中文會變成一排豆腐。
    這幾張圖是給人比大小用的，標籤講的是數字，用英數就夠。
    """
    try:
        return ImageFont.truetype("DejaVuSans.ttf", size)
    except OSError:
        return ImageFont.load_default()


def room_image(name):
    """把一間房間算成 1x 的圖。先鋪 BG，再疊 OBJ。"""
    spec = room.ROOMS[name]
    img = Image.new("RGB", (spec["cols"] * 16, spec["rows"] * 16), (0, 0, 0))
    for layer in ("bg", "obj"):
        for ty, line in enumerate(spec[layer]):
            for tx, ch in enumerate(line):
                if ch == ".":
                    continue
                blit(img, room.TILES[ch], tx * 16, ty * 16, 1, room.PALETTE)
    return img


def cat_image(frame=None):
    """比較圖裡放的是**真的那隻貓**，不是一個代表貓的方塊。

    尺寸感全靠這 16x16 跟房間的比例，用假的東西頂替等於沒比。
    """
    im = Image.new("RGBA", (16, 16), (0, 0, 0, 0))
    blit(im, disi.FRAMES[frame or SHEET[0][0]], 0, 0, 1)
    return im


def build_rooms():
    for name in room.ROOMS:
        room_image(name).save(os.path.join(HERE, "room-%s.png" % name))


def room_scale(name, device):
    """一間房間在某個裝置上會被放大幾倍。倍率決定一切，尺寸是它算出來的。

    兩個裝置的規則不一樣，而差別就是明陽那個左右滑的想法：

      桌機 整間要看得完，所以取寬與高之中比較緊的那個限制（= object-fit: contain）
      手機 高度填滿、寬度溢出去用滑的，所以**只有高度在決定倍率**

    手機那條把欄數從算式裡拿掉了。房間不必再塞進 327px，
    貓的大小就只剩「可用高度 / 列數」，多給幾欄不會再讓貓縮小。
    """
    spec = room.ROOMS[name]
    w, h = spec["cols"] * 16, spec["rows"] * 16
    if device == "phone":
        return float(room.LAYOUT["phone"][1] - room.LAYOUT["chrome_phone"]) / h
    avail_h = room.LAYOUT["desktop"][1] - room.LAYOUT["chrome_desktop"]
    return min(float(room.LAYOUT["breakout"]) / w, float(avail_h) / h)


def build_room_view(name="pano", pad=18):
    """把房間算成它在 1440x900 筆電上**實際的大小**，並框出手機一次看得到的範圍。

    這支原本是比較圖，一次疊好幾個候選尺寸。pano 定案之後比較的部分沒用了
    （要看當時怎麼比的去翻 git），但「照真實大小算一次」要留著：素材是
    256x112，眼睛看不出它上了螢幕會是 1147x502 還是別的數字，而接 CSS 的時候
    唯一要對的就是那組數字。標籤上印的倍率跟貓的 px 數，是拿來跟瀏覽器對帳的。

    非整數倍放大的毛邊**故意不修**。瀏覽器開 image-rendering: pixelated
    也是這樣，磨掉它等於給一張騙人的預覽。

    橘框是手機一次看得到的範圍。它在這張圖的座標系裡是一個固定的寬度，
    因為兩個裝置的倍率都由各自的可用高度決定，比值（466/472）跟房間無關——
    所以框的大小跟房間多寬無關，房間越寬就顯得越小，那個比例正好就是
    「手機一次看得到幾成」。框以貓為中心，因為視角本來就該跟著貓。
    """
    font = room_font(14)
    dh = room.LAYOUT["desktop"][1] - room.LAYOUT["chrome_desktop"]
    ph = room.LAYOUT["phone"][1] - room.LAYOUT["chrome_phone"]
    win = int(round(room.LAYOUT["phone_view"] * float(dh) / ph))

    spec = room.ROOMS[name]
    im = room_image(name)
    w, h = im.size
    # 貓的**腳**落在指定的高度，不是貓的左上角
    fx, fy = room.CAT_AT
    cat = cat_image()
    im.paste(cat, (round(fx * w) - 8, round(fy * h) - 16), cat)

    ds = room_scale(name, "desktop")
    sw, sh = int(round(w * ds)), int(round(h * ds))
    shot = im.resize((sw, sh), Image.NEAREST)
    # 框以貓為中心，但不准滑出房間外——真的捲動容器也是這樣夾的
    bx = max(0, min(sw - win, int(round(fx * sw)) - win // 2))
    label = ("%s  %dx%d tiles = %dx%d px   laptop %dx%d (%.2fx)   "
             "cat %dpx laptop / %dpx phone   phone sees %d%% at a time"
             % (name, spec["cols"], spec["rows"], w, h, sw, sh, ds,
                round(16 * ds), round(16 * room_scale(name, "phone")),
                round(100.0 * win / sw)))

    lh = 24
    out = Image.new("RGB", (sw + pad * 2, sh + lh + pad * 2), BG)
    d = ImageDraw.Draw(out)
    d.text((pad, pad), label, fill=(205, 210, 224), font=font)
    out.paste(shot, (pad, pad + lh))
    x0, y0 = pad + bx, pad + lh
    d.rectangle([x0, y0, x0 + win, y0 + sh - 1], outline=(224, 122, 95), width=3)
    d.text((x0 + 8, y0 + 8), "phone viewport", fill=(224, 122, 95), font=font)
    out.save(os.path.join(HERE, "room-view.png"))


# style.css 的 --room-tint。四個時段疊在房間上的乘算色片。
#
# 這裡重算一次不是備份，是**驗算**：這幾個值當初是拿舊的 --room-wall
# 反推的（舊 dawn 的牆 / 舊 day 的牆 x 255），所以乘回去必須一格不差地
# 還原成舊的牆色。對不上就表示有人動了其中一邊沒動另一邊，底下會印出來。
TOD_TINT = {
    "day": (255, 255, 255),
    "dawn": (200, 183, 222),
    "dusk": (210, 176, 200),
    "night": (121, 134, 161),
}

# 舊版 CSS 房間各時段的牆色，驗算用的答案
TOD_WALL_WAS = {
    "day": (74, 74, 92),
    "dawn": (58, 53, 80),
    "dusk": (61, 51, 72),
    "night": (35, 39, 58),
}


def build_room_tod(name="pano", scale=3, gap=14, pad=16):
    """四個時段並排。判斷「半夜的房間會不會暗到看不見貓」用的。

    multiply 是有定義的算術（每個通道 a*b/255），瀏覽器怎麼算這裡就怎麼算，
    所以這張圖不是示意圖，是**跟畫面上一模一樣**的結果。

    要講清楚的代價：multiply 只能把顏色壓暗、不能推暖，
    所以窗外那片天在黃昏不會變橘，只會跟著暗。窗戶要等 A6 拆成獨立的一層。
    """
    font = room_font(13)
    base = room_image(name)
    fx, fy = room.CAT_AT
    cat = cat_image()
    base.paste(cat, (round(fx * base.size[0]) - 8, round(fy * base.size[1]) - 16), cat)
    w, h = base.size[0] * scale, base.size[1] * scale
    big = base.resize((w, h), Image.NEAREST)

    order = ["dawn", "day", "dusk", "night"]
    lh = 22
    out = Image.new("RGB", (w + pad * 2, (h + lh) * 4 + gap * 3 + pad * 2), BG)
    d = ImageDraw.Draw(out)
    y = pad
    for tod in order:
        tint = TOD_TINT[tod]
        shot = big.point(lambda v, t=tint: v)  # 佔位，實際逐通道算在下面
        px = shot.load()
        for yy in range(h):
            for xx in range(w):
                r0, g0, b0 = px[xx, yy][:3]
                px[xx, yy] = (r0 * tint[0] // 255,
                              g0 * tint[1] // 255,
                              b0 * tint[2] // 255)
        # 驗算：牆色乘完要等於舊版 CSS 那個時段的牆
        was = TOD_WALL_WAS[tod]
        got = tuple(room.PALETTE["W"][i] * tint[i] // 255 for i in range(3))
        ok = "ok" if all(abs(got[i] - was[i]) <= 1 for i in range(3)) else \
             "MISMATCH was #%02x%02x%02x" % was
        d.text((pad, y), "%-5s tint #%02x%02x%02x -> wall #%02x%02x%02x  %s"
               % (tod, tint[0], tint[1], tint[2], got[0], got[1], got[2], ok),
               fill=(205, 210, 224), font=font)
        out.paste(shot, (pad, y + lh))
        y += lh + h + gap
    out.save(os.path.join(HERE, "room-tod.png"))


def build_room_tiles(scale=9, pad=20, per_row=8):
    """每一塊磚放大並排，加格線與名字。抓單格錯誤用，等同貓的 proof.png。"""
    font = room_font(12)
    items = list(room.TILES.items())
    cell = 16 * scale + pad
    cols = min(per_row, len(items))
    rows = (len(items) + per_row - 1) // per_row
    img = Image.new("RGB", (cell * cols + pad, cell * rows + pad + 8), BG)
    d = ImageDraw.Draw(img)
    for i, (key, tile) in enumerate(items):
        ox = pad + (i % per_row) * cell
        oy = pad + (i // per_row) * cell
        d.rectangle([ox, oy, ox + 16 * scale, oy + 16 * scale], fill=(58, 62, 78))
        blit(img, tile, ox, oy, scale, room.PALETTE)
        for k in range(0, 17, 4):
            d.line([(ox + k * scale, oy), (ox + k * scale, oy + 16 * scale)],
                   fill=(96, 100, 118))
            d.line([(ox, oy + k * scale), (ox + 16 * scale, oy + k * scale)],
                   fill=(96, 100, 118))
        d.text((ox + 2, oy + 16 * scale + 3), key, fill=(190, 195, 208), font=font)
    img.save(os.path.join(HERE, "room-tiles.png"))


def lint_room():
    """房間的機械檢查。每一條都對應一種「跑得起來但畫面是壞的」的錯。"""
    msgs = []
    for key, tile in room.TILES.items():
        if len(tile) != 16:
            msgs.append("tile %s: %d rows, want 16" % (key, len(tile)))
        for y, r in enumerate(tile):
            if len(r) != 16:
                msgs.append("tile %s row %d: %d chars, want 16 -> %r"
                            % (key, y, len(r), r))
            bad = set(r) - set(room.PALETTE) - {"."}
            if bad:
                msgs.append("tile %s row %d: not in palette: %s"
                            % (key, y, "".join(sorted(bad))))

    for name, spec in room.ROOMS.items():
        for layer in ("bg", "obj"):
            grid = spec[layer]
            if len(grid) != spec["rows"]:
                msgs.append("%s.%s: %d rows, want %d"
                            % (name, layer, len(grid), spec["rows"]))
            for y, line in enumerate(grid):
                if len(line) != spec["cols"]:
                    msgs.append("%s.%s row %d: %d tiles, want %d -> %r"
                                % (name, layer, y, len(line), spec["cols"], line))
                # bg 不准有透明格：破洞會露出底色，那不是設計，那是漏鋪
                allowed = set(room.TILES) | ({"."} if layer == "obj" else set())
                bad = set(line) - allowed
                if bad:
                    msgs.append("%s.%s row %d: unknown tile: %s"
                                % (name, layer, y, "".join(sorted(bad))))
        msgs.append("%-5s %dx%d px, %d tiles, cat %.1f%% of width"
                    % (name, spec["cols"] * 16, spec["rows"] * 16,
                       spec["cols"] * spec["rows"], 100.0 / spec["cols"]))

    used = set()
    for tile in room.TILES.values():
        for r in tile:
            used |= set(r)
    used -= {"."}
    unused = set(room.PALETTE) - used
    msgs.append("room palette: %d defined, %d used%s" % (
        len(room.PALETTE), len(used),
        (", unused: " + "".join(sorted(unused))) if unused else ""))
    return msgs


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

    print("\n--- room ---")
    room_problems = lint_room()
    print("\n".join(room_problems))

    fatal = [m for m in problems + room_problems
             if "want 16" in m or "not in palette" in m
             or "want %d" in m or "unknown tile" in m or "tiles, want" in m
             or "rows, want" in m]
    if fatal:
        sys.exit("\nfix the map first, nothing rendered")

    build_sheet()
    build_proof()
    build_squint()
    build_anim()
    build_rooms()
    build_room_tiles()
    build_room_view()
    build_room_tod()
    gifs = " ".join("%s.gif" % n for n, _, _ in sequences())
    rooms = " ".join("room-%s.png" % n for n in room.ROOMS)
    print("\nwrote disi-16.png / proof.png / squint.png / " + gifs)
    print("wrote " + rooms + " / room-tiles.png / room-view.png / room-tod.png")
