/*
 * 營業時間的解析與判斷。這支檔案不碰 DOM，純邏輯，方便用 test.html 單獨測。
 *
 * 格式沿用 OpenStreetMap 的 opening_hours 語法（的一個子集），沒有自己發明：
 * 之後若要從 OSM 匯入資料、或改接 Google Places，兩邊都能對映到這個模型，
 * 不必再轉一層。而且它剛好很精簡地表達得出台灣店家常見的兩件事——
 * 中午休息的兩段式營業，以及「隔週公休」。
 *
 * 支援的寫法：
 *   Mo-Su 11:00-21:30              週一到週日
 *   11:00-21:00                    沒寫星期 = 每天
 *   Mo-Fr 11:00-14:30,17:00-21:30  一天兩段（午休）
 *   Mo-Fr 11:00-21:30; Sa-Su 11:00-22:00   分號分隔，後面的規則覆蓋前面的
 *   Mo, We-Su 11:00-21:00          星期可以混用列舉與範圍
 *   Th-Tu 09:30-20:00              跨週的範圍（四五六日一二）
 *   Tu off                         公休
 *   We[2,4] off                    每月第 2、4 個週三公休
 *   Mo-Su 06:00-01:00              跨夜，開到隔天凌晨 1 點
 *   Mo-Su 10:00-24:00              24:00 代表當天結束
 *   24/7                           全年無休
 *
 * 刻意不支援的：國定假日（PH）、指定月份、日出日落。真的需要再加。
 */

const Hours = (function () {
  "use strict";

  // 索引對齊 JS 的 getDay()：0 是週日
  const DAY_NAMES = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
  const DAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];
  const MINUTES_PER_DAY = 1440;

  /* ---------- 解析 ---------- */

  // 一個星期選擇子，例如 Mo / Mo-Fr / We[2,4]。
  // 大小寫不拘：這份資料是手打的，寫成 mo-su 還要被退件太苛了。
  const DAY_TOKEN = /^(Mo|Tu|We|Th|Fr|Sa|Su)(?:\[([\d,\s]+)\])?(?:\s*-\s*(Mo|Tu|We|Th|Fr|Sa|Su))?$/i;
  const TIME_SPAN = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/;

  function dayIndex(name) {
    const target = name.toLowerCase();
    return DAY_NAMES.findIndex((d) => d.toLowerCase() === target);
  }

  /*
   * 星期範圍可能跨週，例如 Th-Tu 是「四五六日一二」而不是空集合，
   * 所以用 +1 繞回去走，不能直接比大小。
   */
  function expandDayRange(fromName, toName) {
    const from = dayIndex(fromName);
    const to = dayIndex(toName);
    const days = [];
    for (let d = from; ; d = (d + 1) % 7) {
      days.push(d);
      if (d === to) break;
    }
    return days;
  }

  /*
   * 只切中括號外面的逗號。We[2,4] 裡面那個逗號屬於「第幾週」的清單，
   * 直接 split(",") 會把它切成 We[2 和 4] 兩段，兩段都不是合法的星期。
   */
  function splitOutsideBrackets(text) {
    const parts = [];
    let current = "";
    let depth = 0;

    for (const ch of text) {
      if (ch === "[") depth++;
      else if (ch === "]") depth--;

      if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += ch;
      }
    }

    parts.push(current);
    return parts;
  }

  function parseDaySelector(text) {
    // days 是 Map<星期, Set<第幾週> | null>，null 代表「每一次都算」
    const days = new Map();

    for (const raw of splitOutsideBrackets(text)) {
      const token = raw.trim();
      if (!token) continue;

      const m = token.match(DAY_TOKEN);
      if (!m) return null;

      const [, fromName, nthText, toName] = m;

      // We[2,4] 這種第幾週的限制只掛在單一天上，跟範圍寫法混用沒有意義
      if (nthText && toName) return null;

      let nth = null;
      if (nthText) {
        nth = new Set();
        for (const n of nthText.split(",")) {
          const value = Number(n.trim());
          if (!Number.isInteger(value) || value < 1 || value > 5) return null;
          nth.add(value);
        }
      }

      const targets = toName ? expandDayRange(fromName, toName) : [dayIndex(fromName)];
      for (const d of targets) {
        // 同一天被提到兩次就放寬成「每一次」，避免默默吃掉其中一條
        if (days.has(d) && days.get(d) !== null && nth) {
          for (const n of nth) days.get(d).add(n);
        } else {
          days.set(d, nth);
        }
      }
    }

    return days.size ? days : null;
  }

  function parseTimeSpan(text) {
    const m = text.trim().match(TIME_SPAN);
    if (!m) return null;

    const fromH = Number(m[1]);
    const fromM = Number(m[2]);
    const toH = Number(m[3]);
    const toM = Number(m[4]);

    if (fromM > 59 || toM > 59) return null;
    if (fromH > 24 || toH > 24) return null;

    const from = fromH * 60 + fromM;
    let to = toH * 60 + toM;

    // 結束時間不大於開始時間 = 跨夜，把結束推到隔天。
    // 06:00-01:00 會變成 360 → 1500，這樣後面就能用單純的區間比較處理。
    if (to <= from) to += MINUTES_PER_DAY;

    return { from: from, to: to };
  }

  /*
   * 把一整條規則字串拆成「星期部分」和「時間部分」。
   * 兩邊都可能出現逗號（Mo, We-Fr 11:00-14:00, 17:00-21:00），
   * 所以不能直接用逗號切——改用「時間一定從數字開始」當分界。
   */
  function splitRule(text) {
    const m = text.match(/^\s*((?:[A-Za-z]{2}(?:\[[\d,\s]*\])?\s*(?:-\s*[A-Za-z]{2}\s*)?,?\s*)*?)((?:\d|off\b|closed\b).*)$/i);
    if (!m) return null;
    return { dayText: m[1].trim().replace(/,\s*$/, ""), timeText: m[2].trim() };
  }

  /**
   * 解析營業時間字串。
   * 回傳 { ok: true, rules, always } 或 { ok: false, error }。
   *
   * 刻意回傳錯誤而不是靜靜當成「沒開」——資料是手動維護的，
   * 打錯字如果沒人講，店會無聲無息地從清單上消失，那比整個壞掉還難發現。
   */
  function parse(input) {
    if (typeof input !== "string" || !input.trim()) {
      return { ok: false, error: "營業時間是空的" };
    }

    const text = input.trim();
    if (text === "24/7") {
      return { ok: true, always: true, rules: [] };
    }

    const rules = [];

    for (const chunk of text.split(";")) {
      const part = chunk.trim();
      if (!part) continue;

      const split = splitRule(part);
      if (!split) return { ok: false, error: `看不懂這段：「${part}」` };

      // 沒寫星期就是每天
      let days = null;
      if (split.dayText) {
        days = parseDaySelector(split.dayText);
        if (!days) return { ok: false, error: `看不懂星期：「${split.dayText}」` };
      }

      if (/^(off|closed)$/i.test(split.timeText)) {
        rules.push({ days: days, off: true, spans: [] });
        continue;
      }

      const spans = [];
      for (const spanText of split.timeText.split(",")) {
        if (!spanText.trim()) continue;
        const span = parseTimeSpan(spanText);
        if (!span) return { ok: false, error: `看不懂時間：「${spanText.trim()}」` };
        spans.push(span);
      }

      if (!spans.length) return { ok: false, error: `這段沒有時間：「${part}」` };
      rules.push({ days: days, off: false, spans: spans });
    }

    if (!rules.length) return { ok: false, error: "沒有解析到任何規則" };
    return { ok: true, always: false, rules: rules };
  }

  /* ---------- 判斷 ---------- */

  function ruleMatches(rule, day, dayOfMonth) {
    if (!rule.days) return true; // 沒指定星期 = 每天
    if (!rule.days.has(day)) return false;

    const nth = rule.days.get(day);
    if (!nth) return true;

    // 這天是當月第幾個同名星期：1 號到 7 號是第 1 個，8 到 14 是第 2 個⋯⋯
    return nth.has(Math.floor((dayOfMonth - 1) / 7) + 1);
  }

  /*
   * 某一天的營業時段。分號分隔的規則是「後面覆蓋前面」，
   * 所以 `11:00-21:00; We[2,4] off` 才會是「平常都開，但那兩個週三公休」。
   */
  function spansOn(parsed, day, dayOfMonth) {
    if (parsed.always) return [{ from: 0, to: MINUTES_PER_DAY }];

    let spans = [];
    for (const rule of parsed.rules) {
      if (!ruleMatches(rule, day, dayOfMonth)) continue;
      spans = rule.off ? [] : rule.spans;
    }
    return spans;
  }

  /*
   * 把相接或重疊的區間合併。這步驟不能省：
   * 「00:00-11:00,20:00-24:00」在晚上 11 點時，今天那段到 24:00 結束、
   * 明天那段從 00:00 開始，不合併的話會誤報「再一小時就打烊」，
   * 但它其實是連續營業到隔天中午。24/7 也靠這步變成一整條。
   */
  function mergeIntervals(intervals) {
    if (!intervals.length) return [];

    const sorted = intervals.slice().sort((a, b) => a.from - b.from);
    const merged = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      const next = sorted[i];
      if (next.from <= last.to) {
        last.to = Math.max(last.to, next.to);
      } else {
        merged.push(next);
      }
    }

    return merged;
  }

  /**
   * 判斷某個時刻是開還是關。
   *
   * now 用 taipeiNow() 產生的物件：{ minutes, days: [昨天, 今天, 明天] }。
   * 一定要看昨天，否則跨夜營業的店在凌晨會被誤判成沒開——
   * 凌晨 00:30 那個「開著」的狀態，是昨天 06:00-01:00 那段還沒結束。
   *
   * 回傳 { open, minutesLeft }：
   *   open 為 true 時 minutesLeft 是還有多久打烊
   *   open 為 false 時是還有多久開門，接下來 48 小時內都不開就是 null
   */
  function statusAt(parsed, now) {
    const intervals = [];

    now.days.forEach(function (info, index) {
      const offset = (index - 1) * MINUTES_PER_DAY; // 昨天 -1440、今天 0、明天 +1440
      for (const span of spansOn(parsed, info.day, info.dayOfMonth)) {
        intervals.push({ from: span.from + offset, to: span.to + offset });
      }
    });

    const merged = mergeIntervals(intervals);
    const at = now.minutes;

    for (const interval of merged) {
      if (at >= interval.from && at < interval.to) {
        return { open: true, minutesLeft: interval.to - at };
      }
    }

    for (const interval of merged) {
      if (interval.from > at) {
        return { open: false, minutesLeft: interval.from - at };
      }
    }

    return { open: false, minutesLeft: null };
  }

  /* ---------- 時間 ---------- */

  /*
   * 店在淡水，營業時間當然是台北時間，跟看的人在哪無關。
   * 所以不用瀏覽器的本地時間，一律換算到 Asia/Taipei——
   * 這樣人在國外開這頁看到的也還是對的。
   */
  function taipeiNow(date) {
    const base = date || new Date();

    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Taipei",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(base)
      .reduce(function (acc, part) {
        acc[part.type] = part.value;
        return acc;
      }, {});

    const year = Number(parts.year);
    const month = Number(parts.month);
    const day = Number(parts.day);
    const hour = Number(parts.hour);
    const minute = Number(parts.minute);

    // 用 UTC 當算盤純粹做日曆加減（前一天、後一天各是星期幾、幾號），
    // 跟時區無關，也就不會被本地時區或日光節約時間干擾。
    const noon = Date.UTC(year, month - 1, day);
    const days = [-1, 0, 1].map(function (offset) {
      const d = new Date(noon + offset * 86400000);
      return { day: d.getUTCDay(), dayOfMonth: d.getUTCDate() };
    });

    return {
      minutes: hour * 60 + minute,
      days: days,
      hour: hour,
      minute: minute,
      label: String(hour).padStart(2, "0") + ":" + String(minute).padStart(2, "0"),
      weekdayLabel: DAY_LABELS[days[1].day],
    };
  }

  /* ---------- 從 Google 匯入 ---------- */

  /*
   * Google Places 回來的 regularOpeningHours.periods 長這樣：
   *   [{ open: {day:1, hour:11, minute:0}, close: {day:1, hour:21, minute:30} }, ...]
   * day 是 0=週日，跟 JS 的 getDay() 一致。
   *
   * 這裡把它轉成本專案用的字串。刻意轉成字串而不是直接存結構化資料，
   * 是因為 Google 的資料也會錯（尤其台灣的小店），轉成人看得懂的一行字，
   * 之後要手改才改得動。
   */

  function formatClock(minutes) {
    const inDay = minutes % MINUTES_PER_DAY;
    // 剛好落在午夜的收店時間寫成 24:00 比 00:00 好懂
    const value = inDay === 0 && minutes > 0 ? MINUTES_PER_DAY : inDay;
    return (
      String(Math.floor(value / 60)).padStart(2, "0") +
      ":" +
      String(value % 60).padStart(2, "0")
    );
  }

  /**
   * 把 Google 的 regularOpeningHours 轉成本專案的營業時間字串。
   * 轉不出來時回傳 null（例如 Google 也不知道這家店的時間）。
   */
  function fromGoogle(googleHours) {
    const periods = googleHours && googleHours.periods;
    if (!Array.isArray(periods) || !periods.length) return null;

    // 24 小時營業的店，Google 只給一個「有開門、沒關門」的 period
    if (periods.length === 1 && periods[0].open && !periods[0].close) return "24/7";

    const byDay = [[], [], [], [], [], [], []];

    for (const period of periods) {
      if (!period.open || !period.close) continue;

      const day = period.open.day;
      if (typeof day !== "number" || day < 0 || day > 6) continue;

      const from = (period.open.hour || 0) * 60 + (period.open.minute || 0);
      let to = (period.close.hour || 0) * 60 + (period.close.minute || 0);

      // 打烊掛在別天的話要把差幾天補回來，跨夜才不會算成負的
      to += (((period.close.day - day) % 7) + 7) % 7 * MINUTES_PER_DAY;
      if (to <= from) to += MINUTES_PER_DAY;

      byDay[day].push({ from: from, to: to });
    }

    const perDayText = byDay.map((spans) =>
      spans.length
        ? spans
            .slice()
            .sort((a, b) => a.from - b.from)
            .map((s) => formatClock(s.from) + "-" + formatClock(s.to))
            .join(",")
        : ""
    );

    // 用「一到日」的順序掃，合併出來的範圍才是 Mo-Fr 這種人習慣的寫法，
    // 而不是從週日開始的 Su-Th
    const ORDER = [1, 2, 3, 4, 5, 6, 0];
    const groups = [];

    ORDER.forEach((day, position) => {
      const text = perDayText[day];
      if (!text) return; // 沒營業的日子直接略過，判斷時沒被任何規則涵蓋就是沒開

      const last = groups[groups.length - 1];
      if (last && last.text === text && last.position === position - 1) {
        last.endDay = day;
        last.position = position;
      } else {
        groups.push({ startDay: day, endDay: day, text: text, position: position });
      }
    });

    if (!groups.length) return null;

    return groups
      .map((g) => {
        const days =
          g.startDay === g.endDay
            ? DAY_NAMES[g.startDay]
            : DAY_NAMES[g.startDay] + "-" + DAY_NAMES[g.endDay];
        return days + " " + g.text;
      })
      .join("; ");
  }

  /** 把分鐘數講成人話：95 → 「1 小時 35 分」 */
  function humanizeMinutes(total) {
    if (total == null) return "";
    const minutes = Math.max(0, Math.round(total));
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return m + " 分";
    if (m === 0) return h + " 小時";
    return h + " 小時 " + m + " 分";
  }

  return {
    parse: parse,
    statusAt: statusAt,
    taipeiNow: taipeiNow,
    humanizeMinutes: humanizeMinutes,
    fromGoogle: fromGoogle,
    MINUTES_PER_DAY: MINUTES_PER_DAY,
    _internal: { spansOn: spansOn, mergeIntervals: mergeIntervals, parseTimeSpan: parseTimeSpan },
  };
})();
