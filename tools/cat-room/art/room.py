"""房間的像素資料。改房間只改這一支，pixel.py 不用動。

跟 disi.py 同一套寫法：一格一個字元的地圖 + 調色盤。差別在**兩層**——
房間不是一張大圖，是一小疊 16x16 的磚，再排一張「哪格放哪塊磚」的表。

為什麼是磚不是整張畫
--------------------

一張 256x192 的房間是 49,152 個像素。用 disi.py 那種一格一個字元的方式硬鋪，
是 192 行 x 256 字元——打不出來，也改不動，更別說畫的人看不見自己畫的東西。

8-bit 主機當年也不是那樣做的：畫十幾塊磚，再排一張磚號表。
磚號表是十幾行、一格一個字元，看得懂也改得動——**跟畫貓完全同一種手感**，
只是那邊一個字元是一個像素，這邊一個字元是一塊 16x16 的磚。

兩層：BG 是牆和地板（不透明，鋪滿），OBJ 是家具（帶透明格，疊在上面）。
分兩層不只是為了好畫——之後「點碗＝餵食」那項要知道哪一格是碗，
物件本來就得是獨立的東西，不能烤進背景裡。

調色盤：房間要冷，貓是暖的
--------------------------

這是這支裡最重要的一個決定，而且很容易做錯。Disi 的主色是 #b89070，
暖棕。**地板如果照直覺畫成木頭色，貓會直接消失在地板上**——
同一個色相、相近的明度，剪影就沒了。

所以地板和牆一律走冷的紫灰，把整個房間推到色輪的另一邊，
貓走到哪裡都跳出來。現在那個 CSS 房間其實已經是這樣了
（`--room-wall: #4a4a5c`、`--room-floor-c: #3a3748`），只是沒人寫下來為什麼。

底下幾個色直接沿用 style.css 既有的 token 值，不是偷懶——
從 CSS 房間換成像素房間的那一刻，顏色不該跟著跳。

地毯是全房間唯一的綠，因為它是唯一需要「不是牆、不是地板、也不是貓」的東西。
"""

PALETTE = {
    "o": (26, 24, 34),      # 最暗：描邊、板縫的縫底
    "k": (46, 44, 58),      # 框線（= --room-frame）
    "S": (63, 63, 80),      # 牆的暗部
    "W": (74, 74, 92),      # 牆（= --room-wall）
    "w": (86, 86, 106),     # 牆的亮部
    "h": (50, 47, 62),      # 地板的板縫
    "f": (58, 55, 72),      # 地板（= --room-floor-c）
    "g": (68, 64, 84),      # 地板的亮邊
    "n": (60, 58, 74),      # 家具的暗面
    "p": (86, 84, 105),     # 家具（= --room-prop）
    "q": (104, 101, 128),   # 家具的亮面
    "s": (191, 227, 245),   # 天空（= --room-sky）
    "t": (74, 107, 99),     # 布：地毯
    "u": (94, 131, 120),    # 布的亮條
    "v": (52, 76, 71),      # 布的暗邊
}

# n 是後來補的，因為家具原本用 p（#565469）當正面，跟牆（#4a4a5c）
# 只差 12 階明度——桌子整個融進牆裡，算出來只看得到桌面那條亮線在飄。
# 立起來的面要比它靠著的牆暗，不是亮。


def _fill(ch):
    return [ch * 16] * 16


def _rows(*rows):
    return list(rows)


# ---------------------------------------------------------------- 牆
#
# 牆刻意畫成平的。16px 的磚上加雜訊只會變髒，而且牆是背景——
# 它的工作是讓貓和家具讀得出來，不是自己好看。
#
# 唯一的變化是一條掛畫線（A），橫過整個房間。一條線就夠把一面死牆
# 分成上下兩段，房間立刻有高度。這是很老的招式，因為它有效。

WALL = _fill("W")

WALL_RAIL = _rows(
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "wwwwwwwwwwwwwwww",   # 亮線在上
    "SSSSSSSSSSSSSSSS",   # 暗線在下 = 線有厚度，不是一條漆
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
)

# 牆腳板。牆和地板直接相接會像兩張色紙拼在一起，
# 有踢腳板才有「牆是立起來的、地板是躺著的」。
WALL_BASE = _rows(
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "WWWWWWWWWWWWWWWW",
    "wwwwwwwwwwwwwwww",
    "SSSSSSSSSSSSSSSS",
    "SSSSSSSSSSSSSSSS",
    "SSSSSSSSSSSSSSSS",
    "oooooooooooooooo",
)


# ---------------------------------------------------------------- 地板
#
# 板子是**直的**（往房間深處延伸），不是橫的。
#
# 第一版畫成橫向板子、每 6 格一條縫、兩塊磚交錯接縫——算出來一看是**磚牆**。
# 橫線 + 交錯的直縫就是砌磚的圖案，那不是地板的圖案，是牆的。
# 一整片地板用錯圖案，房間會變成躺著的牆，貓像在爬牆。
#
# 直板沒有這個問題：只有直線，沒有交錯，怎麼鋪都不會變成磚。
# 板寬 8px，一塊磚剛好兩片板，接縫落在磚的邊界上，所以鋪幾塊都連得起來。
# 縫是「暗一格 + 亮一格」，暗的是縫、亮的是隔壁板被光打到的邊——
# 只有暗線的話那是刻痕，不是兩片木頭。

FLOOR_A = _rows(*(["hgffffffhgffffff"] * 16))

# 唯一的差別是右邊那片板中間有一道橫向的接頭。
# 只有一塊磚有，而且只跨半塊——地板才不會整齊到像方格紙，
# 但也不會多到又變回磚。交錯鋪的時候大約每兩塊出現一次。
FLOOR_B = _rows(
    "hgffffffhgffffff",
    "hgffffffhgffffff",
    "hgffffffhgffffff",
    "hgffffffhgffffff",
    "hgffffffhgffffff",
    "hgffffffhgffffff",
    "hgffffffhgffffff",
    "hgffffffhhhhhhhh",
    "hgffffffhggggggg",
    "hgffffffhgffffff",
    "hgffffffhgffffff",
    "hgffffffhgffffff",
    "hgffffffhgffffff",
    "hgffffffhgffffff",
    "hgffffffhgffffff",
    "hgffffffhgffffff",
)


# ---------------------------------------------------------------- 窗
#
# 2x2 塊磚 = 32x32。十字窗框壓在兩塊磚的接縫上：
# 左磚的最右邊 1px + 右磚的最左邊 1px 合起來才是 2px 的直櫺，
# 上下同理。這樣框的粗細不受磚的邊界影響，而不是硬把框塞進其中一塊。

WIN_TL = _rows(
    "kkkkkkkkkkkkkkkk",
    "kkkkkkkkkkkkkkkk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kkkkkkkkkkkkkkkk",
)

WIN_TR = _rows(
    "kkkkkkkkkkkkkkkk",
    "kkkkkkkkkkkkkkkk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kkkkkkkkkkkkkkkk",
)

WIN_BL = _rows(
    "kkkkkkkkkkkkkkkk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kksssssssssssssk",
    "kkkkkkkkkkkkkkkk",
    "kkkkkkkkkkkkkkkk",
)

WIN_BR = _rows(
    "kkkkkkkkkkkkkkkk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kssssssssssssskk",
    "kkkkkkkkkkkkkkkk",
    "kkkkkkkkkkkkkkkk",
)


# ---------------------------------------------------------------- 家具
#
# 桌子只有 2x1 塊磚。桌面（亮 q）在上、前緣（暗 n）在下，
# 中間夾一條 k——**那條線就是「桌面是水平的、前緣是垂直的」的全部訊息**，
# 沒有它就只是一個灰方塊。桌腳只畫外側兩支，內側那兩支被桌子自己擋住了。

DESK_L = _rows(
    "................",
    "................",
    "................",
    ".kkkkkkkkkkkkkkk",
    ".kqqqqqqqqqqqqqq",
    ".kqqqqqqqqqqqqqq",
    ".kkkkkkkkkkkkkkk",
    ".knnnnnnnnnnnnnn",
    ".knnnnnnnnnnnnnn",
    ".kkkkkkkkkkkkkkk",
    ".knn............",
    ".knn............",
    ".knn............",
    ".knn............",
    ".kkk............",
    "................",
)

DESK_R = _rows(
    "................",
    "................",
    "................",
    "kkkkkkkkkkkkkkk.",
    "qqqqqqqqqqqqqqk.",
    "qqqqqqqqqqqqqqk.",
    "kkkkkkkkkkkkkkk.",
    "nnnnnnnnnnnnnnk.",
    "nnnnnnnnnnnnnnk.",
    "kkkkkkkkkkkkkkk.",
    "............nnk.",
    "............nnk.",
    "............nnk.",
    "............nnk.",
    "............kkk.",
    "................",
)

# 地毯 2x2。條紋每三排一條，是為了讓貓走過去的時候地板有參考線——
# 純色的地毯上，貓的位移會看不太出來。
#
# 邊界原本用 o（近黑）描邊，讀起來是一塊有厚度的板子而不是布。
# 換成 v（暗綠）之後才是「布的邊被自己的影子壓暗」。
RUG_TL = _rows(
    "................",
    "................",
    "................",
    "................",
    "..vvvvvvvvvvvvvv",
    "..vttttttttttttt",
    "..vtuuuuuuuuuuuu",
    "..vttttttttttttt",
    "..vttttttttttttt",
    "..vtuuuuuuuuuuuu",
    "..vttttttttttttt",
    "..vttttttttttttt",
    "..vtuuuuuuuuuuuu",
    "..vttttttttttttt",
    "..vttttttttttttt",
    "..vtuuuuuuuuuuuu",
)

RUG_TR = _rows(
    "................",
    "................",
    "................",
    "................",
    "vvvvvvvvvvvvvv..",
    "tttttttttttttv..",
    "uuuuuuuuuuuuuv..",
    "tttttttttttttv..",
    "tttttttttttttv..",
    "uuuuuuuuuuuuuv..",
    "tttttttttttttv..",
    "tttttttttttttv..",
    "uuuuuuuuuuuuuv..",
    "tttttttttttttv..",
    "tttttttttttttv..",
    "uuuuuuuuuuuuuv..",
)

RUG_BL = _rows(
    "..vttttttttttttt",
    "..vttttttttttttt",
    "..vtuuuuuuuuuuuu",
    "..vttttttttttttt",
    "..vttttttttttttt",
    "..vtuuuuuuuuuuuu",
    "..vttttttttttttt",
    "..vvvvvvvvvvvvvv",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
)

RUG_BR = _rows(
    "tttttttttttttv..",
    "tttttttttttttv..",
    "uuuuuuuuuuuuuv..",
    "tttttttttttttv..",
    "tttttttttttttv..",
    "uuuuuuuuuuuuuv..",
    "tttttttttttttv..",
    "vvvvvvvvvvvvvv..",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
)

# 碗。往下收兩格才是碗，直筒是杯子——這一格的差別就是碗之所以是碗。
BOWL = _rows(
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "................",
    "..kkkkkkkkkkkk..",
    "..kqqqqqqqqqqk..",
    "..kppppppppppk..",
    "...kppppppppk...",
    "....kkkkkkkk....",
    "................",
    "................",
)


# 磚號表用的字元。一個字元一塊磚。
TILES = {
    "W": WALL,
    "A": WALL_RAIL,
    "B": WALL_BASE,
    "f": FLOOR_A,
    "F": FLOOR_B,
    "1": WIN_TL, "2": WIN_TR,
    "3": WIN_BL, "4": WIN_BR,
    "5": DESK_L, "6": DESK_R,
    "7": RUG_TL, "8": RUG_TR,
    "9": RUG_BL, "0": RUG_BR,
    "b": BOWL,
}


# ---------------------------------------------------------------- 版面預算
#
# 房間到底能多大，不是挑一個 max-width 就決定的，是**高度**決定的。
# 房間是固定比例的，加寬就等於加高，而頁面上房間以外的東西已經吃掉一大半。
#
# 量出來的（style.css 與根目錄 style.css）：
#
#     .container            680px，左右各 24 padding  ->  內容欄只有 632px
#     .hero                 72 + 48 padding + 標題 + 小標         ~203px
#     main.container        上下各 44                              88px
#     .note + .actions      16+27 + 18+44                         ~105px
#     .meta                 18 + 1.4em                             ~39px
#     footer                                                       ~60px
#
# 所以現在房間以外吃掉約 500px。1440x900 的筆電只剩 400px 給房間，
# 4:3 之下寬度只能到 529——**比現在寫的 560 還小，頁面本來就在小小捲動。**
#
# 待辦 7（提示文字浮在房間上）和待辦 5（點房間裡的東西取代按鈕列）
# 一做完，那 105px 就還回來了。所以那兩項不是裝飾，**是房間變大的先決條件**。
# 底下的預算都是「那兩項做完之後」算的。
#
# 縮放規則兩個裝置不一樣，而這是整個尺寸決策的關鍵：
#
#   **桌機**：整間房間要看得完，不捲動。倍率取寬與高之中比較緊的那個
#            （等同 object-fit: contain），所以視窗窄的時候是整間縮小，不是被切掉。
#   **手機**：高度填滿，寬度溢出去用左右滑的。
#
# 手機那條是明陽想出來的，它把這題的變數整個換掉了：房間不必塞進 327px 之後，
# 倍率由**列數**決定，欄數不再壓縮貓。
#
#     貓在螢幕上的大小 = 可用高度 / 列數      （兩個裝置都是這條）
#     房間在螢幕上的寬 = 欄數 x 那個倍率
#
# 也就是**列數決定貓多大、欄數決定房間多寬**，兩件事終於拆開了。
# 欄數變成免費的——多給幾欄只是多一點要滑的距離，不會讓貓縮小。

LAYOUT = {
    "column": 632,      # 待在 .container 裡：680 - 24*2
    # 衝出欄位之後的可用寬：1440 的視窗扣掉捲軸 15，再左右各留 48。
    # 在 1440x900 上這條不會生效（高度先卡住），窗變窄才輪得到它。
    "breakout": 1329,
    "desktop": (1440, 900),
    "phone": (375, 812),
    "phone_view": 375,  # 手機一次看得到多寬。房間是滿版的，所以就是視窗寬
    # 這兩個是在瀏覽器裡量的，不是照 CSS 加總估的：
    #     document.scrollHeight - room.clientHeight
    # 桌機估出來是 398、實際 434，差的 36px 就是一條沒必要的捲軸。
    # 手機量到 418，但這裡填 340——扣掉頁尾那 78px，因為手機本來就會上下滑，
    # 硬把頁尾塞進第一屏只會換來一隻小 11px 的貓。style.css 的 --chrome
    # 必須跟這兩個數字一樣，不然校對圖講的尺寸跟瀏覽器就對不起來了。
    "chrome_desktop": 434,
    "chrome_phone": 340,
}


# ---------------------------------------------------------------- 房間
#
# 只有一間。之前有六個候選尺寸（8x6 / 12x9 / 16x12 / 12x7 / 16x9 / 16x7），
# 比完就把沒選上的刪掉了——留著沒人載入的資料只會讓下一個人以為它還有用。
#
# **那六個沒有進過版控**，刪掉的時候這支檔案還沒 commit 過，所以翻 git 找不到，
# 那張比較圖也沒留。剩下的只有底下這段推理——所以底下那段要寫得夠清楚，
# 它是那次比較唯一的遺物。
#
#     16x7 = 256x112   16:7    pano
#
# 為什麼是這個比例：手機那條規則（高度填滿、寬度用滑的）讓欄數變成免費的，
# 所以就把它花光。7 列是「貓還夠大」的下限，16 欄是「滑得到但不會滑到膩」。
#
# 家具重排過一次。原本那個擺法是為了讓六張比較圖之間只有尺寸在變，
# 全部擠在左半邊；一間真的要用的全景房間不能那樣——兩端都要有東西，
# 不然滑過去只是一片空牆，那就白給了欄數。現在是：
#
#     桌子靠左（1-2 欄）  地毯在中間（6-7 欄）  窗和碗在右（9-10 / 13 欄）
#
# 牆是第 0-2 列（第 2 列是踢腳板），地板是第 3-6 列。
#
# 地板佔 7 列裡的 4 列，第一眼會覺得太多。那是**留給 A4 的**：貓之後要在
# 房間裡前後走（不只左右），能走的縱深就是這幾列。地板砍成兩列畫面比例會
# 好看一點，但貓就只剩一條線可以走，2D 移動會看起來像在軌道上滑。
# 先有地方走，構圖之後再說。

ROOMS = {
    "pano": {
        "cols": 16, "rows": 7,
        "bg": [
            "WWWWWWWWWWWWWWWW",
            "AAAAAAAAAAAAAAAA",
            "BBBBBBBBBBBBBBBB",
            "fFfFfFfFfFfFfFfF",
            "FfFfFfFfFfFfFfFf",
            "fFfFfFfFfFfFfFfF",
            "FfFfFfFfFfFfFfFf",
        ],
        "obj": [
            ".........12.....",
            ".........34.....",
            ".56.............",
            "................",
            "......78........",
            "......90........",
            ".............b..",
        ],
    },
}

# 校對圖裡貓站的位置。x 是貓的**中心**、y 是貓的**腳**，用佔房間寬高的比例表示，
# 跟 script.js 裡 cat.x 的定義一樣，所以這張圖量到的位置直接對得上遊戲裡的。
#
# 站在地毯右邊的**空地板**上是刻意的：貓是暖棕、地毯是綠的，那個對比不會失敗；
# 會失敗的是貓對地板（都是中暗調）。校對圖要照的是可能出事的那個，不是好看的那個。
CAT_AT = (0.55, 0.80)
