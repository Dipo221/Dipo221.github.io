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

# 一格貓是幾像素。同樣不寫死：M2 要把 Disi 從 16x16 重畫成 24x24，
# 那一輪應該只動 disi.py 和 sprites.js 的 manifest，不該回來改這支。
CELL = len(disi.FRAMES[SHEET[0][0]])

# sprite sheet 的檔名。跟著格子大小走，見 build_sheet()。
# ../sprites.js 的 manifest 也寫著同一個名字，改這裡要改那裡。
SHEET_PNG = "disi-%d.png" % CELL

# M2 打算把 Disi 重畫成幾像素。**只有校對圖在用**——畫完之後 CELL 自己會
# 變成這個數字，那時候這行就沒有作用了（room-view.png 的參考框會自動消失）。
# 它存在的理由是：房間換成 20x11 的這一輪，貓還是 16x16，
# 光看圖沒辦法判斷「新房間配重畫後的貓比例對不對」，而那件事判斷錯了，
# 賠掉的是整包重畫的美術。所以先在圖上框一個 24x24 出來。
TARGET_CELL = 24

# 一塊房間磚是幾像素。這個是真的固定的（磚號表、CSS 的百分比、
# script.js 的座標全都建立在它上面），寫成常數只是為了讓算式看得懂。
TILE = 16


def rgb(ch):
    return PAL[ch]


def luma(c):
    """相對亮度。剪影讀不讀得出來看的是這個，不是色相。"""
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


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
    """檔名帶著格子大小，所以改尺寸 = 換檔名。

    這不是命名潔癖：`disi-16.png` 裡面裝 24x24 的貓，是一份**會騙人的文件**，
    而這個專案有一半的正確性靠註解和檔名。順帶一個好處是換名字等於換網址，
    sprite sheet 那個「舊快取配新 manifest 會整張錯位」的坑自動就繞過去了。
    """
    img = Image.new("RGBA", (CELL * COLS, CELL * ROWS), (0, 0, 0, 0))
    for i, (_, rows) in enumerate(frames()):
        blit(img, rows, (i % COLS) * CELL, (i // COLS) * CELL, 1)
    save_asset(img, SHEET_PNG)


def build_proof(scale=20, pad=22):
    cell = CELL * scale + pad
    img = Image.new("RGB", (cell * COLS + pad, cell * ROWS + pad), BG)
    d = ImageDraw.Draw(img)
    for i, (name, rows) in enumerate(frames()):
        ox = pad + (i % COLS) * cell
        oy = pad + (i // COLS) * cell
        d.rectangle([ox, oy, ox + CELL * scale, oy + CELL * scale], fill=(58, 62, 78))
        blit(img, rows, ox, oy, scale)
        for k in range(CELL + 1):
            d.line([(ox + k * scale, oy), (ox + k * scale, oy + CELL * scale)],
                   fill=(96, 100, 118))
            d.line([(ox, oy + k * scale), (ox + CELL * scale, oy + k * scale)],
                   fill=(96, 100, 118))
        for k in range(0, CELL, 2):
            d.text((ox + k * scale + 4, oy - 13), str(k), fill=(150, 156, 172))
            d.text((ox - 14, oy + k * scale + 4), str(k), fill=(150, 156, 172))
        d.text((ox + 2, oy + CELL * scale + 4), name, fill=(190, 195, 208))
    img.save(os.path.join(HERE, "proof.png"))


def build_squint(scale=4, gap=6):
    """縮小並排，抓剪影用。

    排法跟 sheet 一樣一排一個姿勢，不是全部擠成一長條——
    要比的是「同一個姿勢的三格會不會抖」跟「這排跟那排認不認得出是兩件事」，
    攤成一條的話這兩件事都要用眼睛跨半張圖去對。
    """
    cell = CELL * scale + gap
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
            im = Image.new("RGB", (CELL * scale, CELL * scale), BG)
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


def room_image(name, pal=None):
    """把一間房間算成 1x 的圖：先鋪 bg 的字元表，再照 place 蓋上具名物件。

    以前是 bg / obj 兩層一樣的迴圈。obj 那層拿掉了——物件從「磚號表裡的
    一個字元」改成「有名字 + 一組座標」，理由寫在 room.py 的 OBJECTS 上面。
    所以這裡變成兩種不同的迴圈：字元表是 y-x 掃過去，物件是照放置順序疊。

    `pal` 換掉整份調色盤就會得到同一間房間的另一種算法。發光層就是這樣來的
    ——同一份磚號表、同一組座標，只是把每個字元對應到「它在夜裡發什麼光」。
    分兩個函式各掃一次的話，兩邊遲早會不同步。
    """
    spec = room.ROOMS[name]
    p = room.PALETTE if pal is None else pal
    img = Image.new("RGB", (spec["cols"] * TILE, spec["rows"] * TILE), (0, 0, 0))
    for ty, line in enumerate(spec["bg"]):
        for tx, ch in enumerate(line):
            blit(img, room.TILES[ch], tx * TILE, ty * TILE, 1, p)
    for oname, ox, oy in spec["place"]:
        o = room.OBJECTS[oname]
        for i, tile in enumerate(o["tiles"]):
            blit(img, tile, (ox + i % o["w"]) * TILE, (oy + i // o["w"]) * TILE, 1, p)
    return img


# 網頁真的會載入的房間素材，改了就得去 style.css 把那張的 `?v=` 加一。
# 從兩張變成六張之後光靠記憶已經不可靠（上一輪就漏掉過一次，症狀是
# 瀏覽器拿到新圖配舊幾何），所以改成存檔的時候自己比對、自己講話。
ASSETS_CHANGED = []


def save_asset(img, fname):
    """存進版控的素材，順便記下它這次有沒有真的變。

    比的是**解碼後的像素**不是檔案的位元組——Pillow 的 PNG 輸出不保證
    每次都一模一樣，比檔案會得到「每次都變了」這種等於沒講的提醒。
    """
    path = os.path.join(HERE, fname)
    old = None
    if os.path.exists(path):
        with Image.open(path) as im:
            old = (im.mode, im.size, im.tobytes())
    img.save(path)
    if old != (img.mode, img.size, img.tobytes()):
        ASSETS_CHANGED.append(fname)


def light_palette():
    """發光層的調色盤：沒登記的字元一律黑。

    黑在 screen 底下等於沒作用，所以這張圖不用去背，也不用管形狀——
    形狀本來就跟底圖一模一樣，因為它是同一份資料算的。
    """
    return dict((ch, room.EMISSIVE.get(ch, (0, 0, 0))) for ch in room.PALETTE)


def build_room_light(name="pano"):
    save_asset(room_image(name, light_palette()), "room-light.png")


def build_sky_rgba(name, tod):
    """某個時段的天空疊圖：整張房間大小，只有玻璃不透明。

    做成整張房間大小、不是裁一塊窗出來，是為了讓 CSS 用 `inset: 0` 定位，
    跟 `::before` / `::after` 一模一樣——**沒有任何窗的座標被抄進 CSS**。
    以後屋頂開天窗、牆上多一扇窗，這一層自動就跟著有。
    圖有 99% 是全透明的，壓完幾乎不佔體積。

    形狀不用另外描：拿同一份磚號表換兩次調色盤就有了，一次出顏色、
    一次出遮罩。發光層也是這樣來的（見 `room_image` 的 `pal`）。
    """
    mask_pal = dict((ch, (255, 255, 255) if ch in room.SKY_CHARS else (0, 0, 0))
                    for ch in room.PALETTE)
    color_pal = dict((ch, room.SKY_TOD[tod].get(ch, (0, 0, 0)))
                     for ch in room.PALETTE)
    img = room_image(name, color_pal).convert("RGBA")
    img.putalpha(room_image(name, mask_pal).convert("L"))
    return img


def build_room_sky(name="pano"):
    for tod in room.SKY_TOD:
        save_asset(build_sky_rgba(name, tod), "room-sky-%s.png" % tod)


def write_room_data(name="pano"):
    """把房間的幾何吐成一支 JS。頁面從此不用自己抄一份座標。

    在這之前 script.js 有兩組是照著磚號表用眼睛量出來的數字：地板的前後界
    （`FLOOR`）跟餵食時要走到哪裡。磚號表一改它們就默默錯掉——不會報錯，
    只會變成貓走進牆裡、或者對著空地低頭吃。資料只有一份就不會有這種事。

    順便把待辦第 5 項（點房間裡的東西取代按鈕列）要的表一起帶出去：
    以後每擺一件家具，它的可點區塊自動就有座標了。
    """
    spec = room.ROOMS[name]
    rows = spec["rows"]
    top, bottom = spec["walk_rows"]
    objs = ",\n".join(
        '    "%s": [%d, %d, %d, %d]' % (n, x, y,
                                        room.OBJECTS[n]["w"], room.OBJECTS[n]["h"])
        for n, x, y in spec["place"])
    js = '''/*
 * 房間的幾何。**這支是 art/pixel.py 產的，不要手改**——
 * 改 art/room.py 再跑一次 `python pixel.py`，這裡就會跟著對。
 *
 * 手改的話下一次跑那支就會被蓋掉，而且沒有任何東西會提醒你。
 */
window.RoomData = {
  cols: %d,
  rows: %d,
  tile: %d,

  /*
   * 貓的腳走得到的前後界，用佔房間高度的比例表示——跟 cat.y 同一個座標系，
   * 所以拿來就能用。來源是 room.py 的 walk_rows（第 %.1f 列到第 %.1f 列）。
   */
  floorTop: %.4f,
  floorBottom: %.4f,

  // 名字: [欄, 列, 寬, 高]，單位是磚。左上角對齊那一格
  objects: {
%s
  }
};
''' % (spec["cols"], rows, TILE, top, bottom,
       float(top) / rows, float(bottom) / rows, objs)
    path = os.path.join(os.path.dirname(HERE), "room-data.js")
    old = ""
    if os.path.exists(path):
        with open(path, encoding="utf-8") as fh:
            old = fh.read()
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(js)

    # 這支變了就一定要把 index.html 的 `room-data.js?v=` 加一。
    #
    # 忘記加的後果比忘記加圖的號碼更難發現：圖有自己的 ?v=，所以回訪的人
    # 會拿到**新的圖配快取裡的舊幾何**——房間看起來是對的，只有地板範圍
    # 跟物件座標默默錯掉，貓走進牆裡或者對著空地低頭吃。
    # 實際發生過一次（窗戶加大那一版），所以這裡改成會自己講話。
    return "room-data.js CHANGED -> bump ?v= in index.html" if old != js else ""


def cat_image(frame=None):
    """比較圖裡放的是**真的那隻貓**，不是一個代表貓的方塊。

    尺寸感全靠這一格跟房間的比例，用假的東西頂替等於沒比。
    """
    im = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
    blit(im, disi.FRAMES[frame or SHEET[0][0]], 0, 0, 1)
    return im


def paste_cat(im):
    """把貓貼在校對圖上的 CAT_AT。x 是貓的**中心**、y 是貓的**腳**。"""
    w, h = im.size
    fx, fy = room.CAT_AT
    cat = cat_image()
    im.paste(cat, (round(fx * w) - CELL // 2, round(fy * h) - CELL), cat)
    return im


def build_rooms():
    for name in room.ROOMS:
        save_asset(room_image(name), "room-%s.png" % name)


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
    im = paste_cat(room_image(name))
    w, h = im.size
    fx, fy = room.CAT_AT

    ds = room_scale(name, "desktop")
    sw, sh = int(round(w * ds)), int(round(h * ds))
    shot = im.resize((sw, sh), Image.NEAREST)
    # 框以貓為中心，但不准滑出房間外——真的捲動容器也是這樣夾的
    bx = max(0, min(sw - win, int(round(fx * sw)) - win // 2))
    label = ("%s  %dx%d tiles = %dx%d px   laptop %dx%d (%.2fx)   "
             "cat %dpx now / %dpx at %d src px   phone sees %d%% at a time"
             % (name, spec["cols"], spec["rows"], w, h, sw, sh, ds,
                round(CELL * ds), round(TARGET_CELL * ds), TARGET_CELL,
                round(100.0 * win / sw)))

    lh = 24
    out = Image.new("RGB", (sw + pad * 2, sh + lh + pad * 2), BG)
    d = ImageDraw.Draw(out)
    d.text((pad, pad), label, fill=(205, 210, 224), font=font)
    out.paste(shot, (pad, pad + lh))
    x0, y0 = pad + bx, pad + lh
    d.rectangle([x0, y0, x0 + win, y0 + sh - 1], outline=(224, 122, 95), width=3)
    d.text((x0 + 8, y0 + 8), "phone viewport", fill=(224, 122, 95), font=font)

    # 重畫後那隻貓會佔多大的一塊。M1 結束時貓還是 16x16，光看圖沒辦法判斷
    # 「20x11 的房間配 24x24 的貓比例對不對」——那件事要等 M2 畫完才看得到，
    # 而那時候要是比例錯了，賠掉的是整包重畫的美術。所以先框出來。
    # 框的底邊對齊貓的腳，不是對齊貓的中心：地板上的東西是靠腳站的位置對位的。
    if TARGET_CELL != CELL:
        bw = TARGET_CELL * ds
        cx, cy = pad + fx * sw, pad + lh + fy * sh
        d.rectangle([cx - bw / 2, cy - bw, cx + bw / 2, cy],
                    outline=(122, 186, 148), width=2)
        d.text((cx + bw / 2 + 6, cy - bw), "%dx%d" % (TARGET_CELL, TARGET_CELL),
               fill=(122, 186, 148), font=font)
    out.save(os.path.join(HERE, "room-view.png"))


# style.css 的 --room-tint。四個時段疊在房間上的乘算色片。
#
# 上一版這幾個值是**拿舊的 CSS 牆色反推**出來的，這支還會驗算乘回去對不對，
# 對不上就印 MISMATCH。那條檢查已經拿掉了：它的用意是「從 CSS 方塊換成
# 像素房間的時候牆色不准跳」，而這一輪牆色是**故意**要換的——
# 房間從冷紫換成暖磚，留著那條只會每次都紅。
#
# 現在這四個值是照暖底色重挑的，各自要負責一件事：
#
#   day   不動。**畫出來的顏色就是中午看到的顏色**，不然畫的時候是在猜。
#   dawn  往冷灰紫壓。清晨的光是冷的，暖房間要被它「退火」才像早上
#   dusk  R 留在 255，只砍 G 跟 B。這是 multiply 唯一推得出橘色的方式，
#         也是換暖底色最主要的回報——上一版的黃昏跟清晨長得幾乎一樣
#   night 壓到藍。代價寫在下面 TOD_GLOW
TOD_TINT = {
    "day": (255, 255, 255),
    "dawn": (192, 188, 224),
    "dusk": (255, 194, 158),
    "night": (96, 110, 152),
}

# style.css 的 --room-glow：發光層的不透明度。
#
# 為什麼非有它不可：multiply **只能往暗走**。一間暖房間的夜晚重點在光
# （窗、之後的燈），而光被乘暗就沒有意義了。所以夜晚另外疊一層 screen。
#
# dusk 是 0 不是折衷值。room.EMISSIVE 登記的是**藍色的夜空**，
# 黃昏開著它等於在一片橘裡面點一扇藍窗，會把 dusk 那條唯一的回報打掉。
# 等 M3 有了檯燈（暖色的發光像素），黃昏才會需要它。
TOD_GLOW = {"day": 0.0, "dawn": 0.30, "dusk": 0.0, "night": 1.0}


def screen(b, l):
    """screen 混色，跟瀏覽器同一條算式。"""
    return 255 - (255 - b) * (255 - l) // 255


def build_room_tod(name="pano", scale=3, gap=14, pad=16):
    """四個時段並排。判斷「半夜的房間會不會暗到看不見貓」用的。

    multiply 跟 screen 都是有定義的算術，瀏覽器怎麼算這裡就怎麼算，
    所以這張圖不是示意圖，是**跟畫面上一模一樣**的結果。疊法也照 CSS 的順序：
    先乘時段色片（`.room::before`），再用 `--room-glow` 的不透明度 screen
    發光層（`.room::after`）。順序反過來結果就不一樣了。

    貓在色片**底下**、發光層底下——環境光本來就該打到貓身上，
    貓不該是房間裡唯一不受光的東西。天空層在**最上面**，兩層都不吃：
    它是屋外的東西，不該被屋裡的燈染色（見 room.py 的 SKY_TOD）。

    誠實要講的代價：multiply 保持比例，所以整個房間被壓暗的時候，
    貓跟地板的亮度差是**按比例縮小**的。暖房間本來就比舊的冷房間差得少，
    夜晚再乘 0.42 之後那個差會小到十幾階。發光層跟 M3 的燈就是要補這個。
    """
    font = room_font(13)
    base = paste_cat(room_image(name))
    light = room_image(name, light_palette())
    bw, bh = base.size
    w, h = bw * scale, bh * scale

    order = ["dawn", "day", "dusk", "night"]
    lh = 22
    out = Image.new("RGB", (w + pad * 2, (h + lh) * 4 + gap * 3 + pad * 2), BG)
    d = ImageDraw.Draw(out)
    y = pad
    for tod in order:
        tint, glow = TOD_TINT[tod], TOD_GLOW[tod]
        # 算在 1x 上再放大，不是放大了再算。NEAREST 只是把像素複製，
        # 兩種順序結果一樣，但這樣少算九倍的像素
        shot = base.copy()
        px, lp = shot.load(), light.load()
        for yy in range(bh):
            for xx in range(bw):
                c = px[xx, yy][:3]
                c = [c[i] * tint[i] // 255 for i in range(3)]
                if glow:
                    g = lp[xx, yy][:3]
                    c = [int(round(c[i] * (1 - glow) + screen(c[i], g[i]) * glow))
                         for i in range(3)]
                px[xx, yy] = tuple(c)
        # 天空層在兩層之後才蓋上去，跟 CSS 的 z-index 一樣。
        # 跟真的素材共用 build_sky_rgba()，所以這張圖不可能跟畫面不同步
        sky = build_sky_rgba(name, tod)
        shot.paste(sky, (0, 0), sky)
        wall = tuple(room.PALETTE["b"][i] * tint[i] // 255 for i in range(3))
        d.text((pad, y),
               "%-5s tint #%02x%02x%02x  glow %.2f  ->  brick #%02x%02x%02x L%.0f"
               % (tod, tint[0], tint[1], tint[2], glow,
                  wall[0], wall[1], wall[2], luma(wall)),
               fill=(205, 210, 224), font=font)
        out.paste(shot.resize((w, h), Image.NEAREST), (pad, y + lh))
        y += lh + h + gap
    out.save(os.path.join(HERE, "room-tod.png"))


def build_room_tiles(scale=9, pad=20, per_row=8):
    """每一塊磚放大並排，加格線與名字。抓單格錯誤用，等同貓的 proof.png。

    物件的磚也要進來。它們是手打的，最容易出錯的就是那一半——
    只印磚號表裡那幾塊，等於把最需要看的東西漏掉。
    """
    font = room_font(12)
    items = all_tiles()
    cell = TILE * scale + pad
    cols = min(per_row, len(items))
    rows = (len(items) + per_row - 1) // per_row
    img = Image.new("RGB", (cell * cols + pad, cell * rows + pad + 8), BG)
    d = ImageDraw.Draw(img)
    for i, (key, tile) in enumerate(items):
        ox = pad + (i % per_row) * cell
        oy = pad + (i // per_row) * cell
        d.rectangle([ox, oy, ox + TILE * scale, oy + TILE * scale], fill=(58, 62, 78))
        blit(img, tile, ox, oy, scale, room.PALETTE)
        for k in range(0, TILE + 1, 4):
            d.line([(ox + k * scale, oy), (ox + k * scale, oy + TILE * scale)],
                   fill=(96, 100, 118))
            d.line([(ox, oy + k * scale), (ox + TILE * scale, oy + k * scale)],
                   fill=(96, 100, 118))
        d.text((ox + 2, oy + TILE * scale + 3), key, fill=(190, 195, 208), font=font)
    img.save(os.path.join(HERE, "room-tiles.png"))


def all_tiles():
    """磚 + 所有具名物件的磚。檢查與色盤統計都要走完這兩邊。

    物件的磚不在 `room.TILES` 裡（它們掛在 OBJECTS 底下），漏掉的話
    畫得出來卻沒被檢查——那正是最容易出錯的一半，因為它們是手打的。
    """
    out = [("tile " + k, t) for k, t in room.TILES.items()]
    for name, o in room.OBJECTS.items():
        for i, t in enumerate(o["tiles"]):
            out.append(("%s[%d]" % (name, i), t))
    return out


def shares(counts):
    """把次數表換成佔比，由大到小。"""
    total = float(sum(counts.values())) or 1.0
    return sorted(((ch, n / total) for ch, n in counts.items()),
                  key=lambda p: -p[1])


def floor_colours(name):
    """地板那幾列實際鋪出來的顏色佔比。

    不是「FLOOR 這塊磚裡有什麼色」——磚號表上深板、接頭、一般板的**數量**
    才決定地板整體看起來多亮。所以要照真的鋪法數。
    """
    spec = room.ROOMS[name]
    r0, r1 = spec["floor_rows"]
    counts = {}
    for line in spec["bg"][r0:r1]:
        for ch in line:
            for r in room.TILES[ch]:
                for c in r:
                    counts[c] = counts.get(c, 0) + 1
    return counts


def cat_colours():
    """Disi 全部幀裡不透明像素的顏色佔比。"""
    counts = {}
    for rows in disi.FRAMES.values():
        for r in rows:
            for ch in r:
                if ch != ".":
                    counts[ch] = counts.get(ch, 0) + 1
    return counts


# 地板跟貓的**身體**之間，亮度至少要差這麼多。
#
# 這條是 room.py 開頭那個決定的**機器版**：暖色房間的地板照直覺畫成蜜色木頭，
# Disi 會直接消失在地板上。寫成註解沒有用——那是會被本能反射違反的規則，
# 要有東西擋著，跟 `bondDelta >= 0` 同一個做法。
#
# 門檻是量出來的不是挑的。三個真實的量測（都是這支自己算的）：
#
#     舊版的冷紫地板（已知看得很清楚）  最近的一對差 51.1   （地板 g L66.3 對貓 m L117.4）
#     這一版的暖木地板                  最近的一對差 40.5   （地板 F L76.9 對貓 m L117.4）
#     參考圖那種蜜色地板 #b07a45         最近的一對差 12.3
#
# 30 卡在中間：比現在這版低 10 階（改地板還有得動），比蜜色高 18 階（照抄一定擋下來）。
# 要放寬它之前先回頭看這三個數字——它不是一個好聽的整數。
#
# 第一次寫這條的時候是拿「貓所有佔面積大的顏色」去比，量出來 10.0 直接紅了，
# 而拿舊版那間已知好用的房間去跑同一條算式只有 2.7。錯的是算式不是房間：
# 佔比最大的那個色是**描邊**，而描邊比地板暗正是它該做的事。留著這段是因為
# 「把描邊算進身體色」看起來完全合理，下一個人很可能會再犯一次。
MIN_LUMA_GAP = 30.0

# 佔比低於這個的顏色不算——眼睛、鼻頭都只有幾格，
# 它們糊不糊掉不影響剪影，卻會把門檻拉到不可能過。
BULK_SHARE = 0.10


def lint_contrast(name="pano"):
    """地板會不會把貓吃掉。比的是**亮度**不是色相，因為剪影讀的是亮度。

    描邊跟身體分開看，因為它們要的方向相反：
    身體要跟地板**拉開**（差太少就融進去），描邊要比地板**暗**
    （比地板亮的話貓會鑲一圈光暈，不是描邊）。
    """
    msgs = []
    floor = [(ch, s) for ch, s in shares(floor_colours(name)) if s >= BULK_SHARE]
    cat = [(ch, s) for ch, s in shares(cat_colours())
           if s >= BULK_SHARE and ch != disi.OUTLINE]
    msgs.append("floor bulk: " + "  ".join(
        "%s %.0f%% L%.1f" % (ch, s * 100, luma(room.PALETTE[ch])) for ch, s in floor))
    msgs.append("cat  body : " + "  ".join(
        "%s %.0f%% L%.1f" % (ch, s * 100, luma(PAL[ch])) for ch, s in cat))
    if not floor or not cat:
        return msgs

    worst = min(((abs(luma(room.PALETTE[f]) - luma(PAL[c])), f, c)
                 for f, _ in floor for c, _ in cat))
    gap, fch, cch = worst
    msgs.append("closest pair: floor %s L%.1f vs cat %s L%.1f = %.1f (min %.1f)%s"
                % (fch, luma(room.PALETTE[fch]), cch, luma(PAL[cch]),
                   gap, MIN_LUMA_GAP, "" if gap >= MIN_LUMA_GAP
                   else "   <- CONTRAST too low, cat melts into the floor"))

    # 描邊對地板**主色**（不是每一個色）。板縫本來就比描邊暗，那是細線不是面積
    main = floor[0][0]
    ol, fl = luma(PAL[disi.OUTLINE]), luma(room.PALETTE[main])
    msgs.append("outline %s L%.1f vs floor %s L%.1f = %+.1f (wants negative)%s"
                % (disi.OUTLINE, ol, main, fl, ol - fl,
                   "" if ol < fl else "   <- CONTRAST outline is lighter, cat gets a halo"))
    return msgs


def lint_sky_tod():
    """天空那張表。兩條，都對應一種「圖出得來但畫面是壞的」。

    `day` 那排必須等於 `PALETTE`：白天沒有別的東西蓋在窗上，兩邊一旦分家，
    轉場到白天的那 1.2 秒裡窗會閃一下——只有動態下看得到，靜態圖抓不到。

    四個時段的字元集必須一樣：漏掉一個字元的那個時段，那一片玻璃會變成
    透明，露出底下**吃過 multiply 的**同一塊天空，也就是原本那片灰。
    """
    msgs = []
    missing = [ch for ch in room.SKY_CHARS if ch not in room.PALETTE]
    if missing:
        msgs.append("SKY_TOD: SKY_CHARS %s not in palette" % "".join(missing))

    want = set(room.SKY_CHARS)
    for tod, table in room.SKY_TOD.items():
        if set(table) != want:
            msgs.append("SKY_TOD[%s]: has %s, want %s"
                        % (tod, "".join(sorted(table)), "".join(sorted(want))))
    for ch in room.SKY_CHARS:
        got, base = room.SKY_TOD["day"].get(ch), room.PALETTE.get(ch)
        if got != base:
            msgs.append("SKY_TOD[day][%s] = %s, must equal PALETTE %s"
                        % (ch, got, base))

    if not msgs:
        msgs.append("sky: %d tods x %d chars (%s), day matches palette"
                    % (len(room.SKY_TOD), len(room.SKY_CHARS),
                       " ".join(room.SKY_TOD)))
    return msgs


def lint_room():
    """房間的機械檢查。每一條都對應一種「跑得起來但畫面是壞的」的錯。"""
    msgs = []
    for key, tile in all_tiles():
        if len(tile) != TILE:
            msgs.append("%s: %d rows, want %d" % (key, len(tile), TILE))
        for y, r in enumerate(tile):
            if len(r) != TILE:
                msgs.append("%s row %d: %d chars, want %d -> %r"
                            % (key, y, len(r), TILE, r))
            bad = set(r) - set(room.PALETTE) - {"."}
            if bad:
                msgs.append("%s row %d: not in palette: %s"
                            % (key, y, "".join(sorted(bad))))

    for name, o in room.OBJECTS.items():
        if len(o["tiles"]) != o["w"] * o["h"]:
            msgs.append("object %s: %d tiles, want %dx%d = %d"
                        % (name, len(o["tiles"]), o["w"], o["h"], o["w"] * o["h"]))

    msgs += lint_sky_tod()

    for name, spec in room.ROOMS.items():
        grid = spec["bg"]
        if len(grid) != spec["rows"]:
            msgs.append("%s.bg: %d rows, want %d" % (name, len(grid), spec["rows"]))
        for y, line in enumerate(grid):
            if len(line) != spec["cols"]:
                msgs.append("%s.bg row %d: %d tiles, want %d -> %r"
                            % (name, y, len(line), spec["cols"], line))
            # bg 不准有透明格：破洞會露出底色，那不是設計，那是漏鋪
            bad = set(line) - set(room.TILES)
            if bad:
                msgs.append("%s.bg row %d: unknown tile: %s"
                            % (name, y, "".join(sorted(bad))))

        # 物件超出房間就會被默默切掉——圖上看起來像少畫了一塊，不像放錯位置
        for oname, ox, oy in spec["place"]:
            if oname not in room.OBJECTS:
                msgs.append("%s.place: no such object: %s" % (name, oname))
                continue
            o = room.OBJECTS[oname]
            if ox < 0 or oy < 0 or ox + o["w"] > spec["cols"] or oy + o["h"] > spec["rows"]:
                msgs.append("%s.place %s at (%d,%d) %dx%d: outside the room"
                            % (name, oname, ox, oy, o["w"], o["h"]))

        msgs.append("%-5s %dx%d px, %d tiles, %d objects, cat %.1f%% of width"
                    % (name, spec["cols"] * TILE, spec["rows"] * TILE,
                       spec["cols"] * spec["rows"], len(spec["place"]),
                       100.0 / spec["cols"]))
        msgs += lint_contrast(name)

    used = set()
    for _, tile in all_tiles():
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


def lint_face_symmetry():
    """臉上的東西有沒有對稱於 disi.FACE_MID。

    這條是明陽抓出來的，不是我想到的：24x24 第一版鼻子在 x6-7（中心 6.5），
    奶油卻左邊給兩格右邊給一格，下面的口鼻塊中心又落在 5.5。
    **差一格在單幀上看不出來，動起來也看不出來，但整張臉就是歪的。**

    量的是眼（e）、鼻與耳內（p）、以及**整塊口鼻**的奶油（c）。

    第一版的 c 只量「有 p 的那一列」，理由是胸口和腳掌也是 c、那些本來就
    不對稱。結果歪掉的正好是鼻子**下面**那兩列——沒有 p，整個口鼻的下半段
    從來沒被檢查過，四個頭裡有四處一路綠燈。**用「哪一列」當範圍是猜的。**

    改成從鼻子的 p 出發做四連通填充，走得到的 c 就是口鼻那一塊，逐列量。
    範圍變成算出來的，而它成立是靠 disi.py 已經寫死的那條設計規則：
    **奶油色斷在脖子**，所以胸口那塊碰不到、不會被誤抓。哪天有人把它接起來
    這裡就會叫——而那件事本來就是禁止的，叫得剛好。
    """
    msgs = []
    mid = getattr(disi, "FACE_MID", None)
    if mid is None:
        return msgs

    def muzzle_rows(rows):
        """從鼻子往外淹，回傳每一列的奶油 x 座標。"""
        seen = set()
        stack = [(x, y) for y, r in enumerate(rows)
                 for x, ch in enumerate(r) if ch == "p"]
        while stack:
            x, y = stack.pop()
            for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
                if (nx, ny) in seen or not (0 <= ny < len(rows)):
                    continue
                if 0 <= nx < len(rows[ny]) and rows[ny][nx] == "c":
                    seen.add((nx, ny))
                    stack.append((nx, ny))
        out = {}
        for x, y in seen:
            out.setdefault(y, []).append(x)
        return out

    bad = 0
    for name in sorted(disi.FRAMES):
        rows = disi.FRAMES[name]
        spans = [(y, ch, [x for x, c in enumerate(row) if c == ch])
                 for y, row in enumerate(rows) for ch in "ep"]
        spans += [(y, "c", xs) for y, xs in muzzle_rows(rows).items()]
        for y, ch, xs in spans:
            if not xs:
                continue
            got = (min(xs) + max(xs)) / 2.0
            if got != mid:
                bad += 1
                msgs.append("FACE %s row %d: %s spans x%d-%d, mid %.1f, want %.1f"
                            % (name, y, ch, min(xs), max(xs), got, mid))
    if not bad:
        msgs.append("face: %d frames symmetric about x%.1f" % (len(disi.FRAMES), mid))
    return msgs


def lint():
    msgs = []
    for name, rows in disi.FRAMES.items():
        if len(rows) != CELL:
            msgs.append("%s: %d rows, want %d" % (name, len(rows), CELL))
        for y, r in enumerate(rows):
            if len(r) != CELL:
                msgs.append("%s row %d: %d chars, want %d -> %r"
                            % (name, y, len(r), CELL, r))
            bad = set(r) - set(PAL) - {"."}
            if bad:
                msgs.append("%s row %d: not in palette: %s" % (name, y, "".join(sorted(bad))))

        def at(x, y):
            if 0 <= y < len(rows) and 0 <= x < len(rows[y]):
                return rows[y][x]
            return "."

        for y in range(len(rows)):
            for x in range(len(rows[y])):
                if at(x, y) == "." or len(rows[y]) != CELL:
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
            if any(len(r) != CELL for r in a + b):
                continue
            diff = sum(1 for y in range(CELL) for x in range(CELL)
                       if a[y][x] != b[y][x])
            if name in shifted or prev in shifted:
                tag = "   (deliberate shift)"
            else:
                tag = "" if diff <= 24 else "   <- large, frames may jitter"
            msgs.append("%-5s %s -> %s: %d px%s" % (anim, prev, name, diff, tag))

    msgs += check_rigid_head()
    msgs += lint_face_symmetry()

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

    # 這幾個關鍵字是「圖會壞掉」的錯，不是「圖不好看」。
    # CONTRAST 也在裡面：地板亮到把貓吃掉，畫面是壞的，只是壞在看不見。
    fatal = [m for m in problems + room_problems
             if "not in palette" in m or "unknown tile" in m
             or ", want" in m or "outside the room" in m or "CONTRAST" in m
             or "SKY_TOD" in m or m.startswith("FACE ")]
    if fatal:
        sys.exit("\nfix the map first, nothing rendered")

    build_sheet()
    build_proof()
    build_squint()
    build_anim()
    build_rooms()
    build_room_light()
    build_room_sky()
    bumped = write_room_data()
    build_room_tiles()
    build_room_view()
    build_room_tod()
    gifs = " ".join("%s.gif" % n for n, _, _ in sequences())
    rooms = " ".join("room-%s.png" % n for n in room.ROOMS)
    skies = " ".join("room-sky-%s.png" % t for t in room.SKY_TOD)
    print("\nwrote " + SHEET_PNG + " / proof.png / squint.png / " + gifs)
    print("wrote " + rooms + " / room-light.png / " + skies)
    print("wrote room-tiles.png / room-view.png / room-tod.png")
    print("wrote ../room-data.js")
    if ASSETS_CHANGED:
        print("\nCHANGED -> bump ?v= in style.css: " + " ".join(ASSETS_CHANGED))
    if bumped:
        print(bumped)
