/*
 * 房間的幾何。**這支是 art/pixel.py 產的，不要手改**——
 * 改 art/room.py 再跑一次 `python pixel.py`，這裡就會跟著對。
 *
 * 手改的話下一次跑那支就會被蓋掉，而且沒有任何東西會提醒你。
 */
window.RoomData = {
  cols: 20,
  rows: 11,
  tile: 16,

  /*
   * 貓的腳走得到的前後界，用佔房間高度的比例表示——跟 cat.y 同一個座標系，
   * 所以拿來就能用。來源是 room.py 的 walk_rows（第 7.5 列到第 10.9 列）。
   */
  floorTop: 0.6818,
  floorBottom: 0.9909,

  // 名字: [欄, 列, 寬, 高]，單位是磚。左上角對齊那一格
  objects: {
    "window": [8, 2, 4, 4],
    "bowl": [16, 9, 1, 1],
    "wand": [5, 5, 2, 2],
    "bed": [1, 4, 4, 5]
  }
};
