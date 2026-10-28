import "./style.css";

/* ===================================================================
 * 存储层：全部走 localStorage，零网络、同步读取，启动即出数据不卡。
 * =================================================================== */
const STORE = {
  favs: "yj.favs",
  current: "yj.current",
  history: "yj.history",
  cache: "yj.cache",

  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  },
  write(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
    } catch {
      /* 配额满时静默失败，不影响主流程 */
    }
  },
};

/* ===================================================================
 * 后端桥接：优先走 Tauri invoke；在浏览器里预览时降级到 mock，
 * 保证 UI 能独立调通。
 * =================================================================== */
const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let invokeFn = null;
async function getInvoke() {
  if (invokeFn) return invokeFn;
  if (!isTauri) {
    invokeFn = async (cmd, args) => mockInvoke(cmd, args);
    return invokeFn;
  }
  const mod = await import("@tauri-apps/api/core");
  invokeFn = mod.invoke;
  return invokeFn;
}

/* 浏览器预览用的假数据（仅 isTauri=false 时生效） */
const MOCK_PRICES = {
  beijing: [8.61, 9.17, 10.67, 8.36],
  shanghai: [8.57, 9.12, 10.42, 8.31],
  guangdong: [8.63, 9.35, 11.35, 8.31],
  shenzhen: [8.58, 9.28, 11.28, 8.26],
  sichuan: [8.7, 9.3, 10.61, 8.34],
  zhejiang: [8.58, 9.14, 10.44, 8.33],
  jiangsu: [8.57, 9.11, 10.31, 8.3],
  shandong: [8.56, 9.19, 10.39, 8.31],
};
// mock 数据也带 -10# 柴油，便于在浏览器里验证完整布局
const GRADES = ["92#", "95#", "98#", "0#", "-10#"];

async function mockInvoke(cmd, args) {
  await new Promise((r) => setTimeout(r, 320));
  const mk = (slug, name) => {
    const base = MOCK_PRICES[slug] || [
      8.5 + Math.random() * 0.2,
      9.1 + Math.random() * 0.2,
      10.4 + Math.random() * 0.3,
      8.3 + Math.random() * 0.1,
    ];
    const fuels = GRADES.map((g, i) => ({
      grade: g,
      price:
        i < base.length
          ? Math.round(base[i] * 100) / 100
          : Math.round((base[3] + 0.5) * 100) / 100,
    }));
    return {
      slug,
      name,
      fuels,
      updated_at: Math.floor(Date.now() / 1000),
    };
  };
  if (cmd === "get_price") {
    return mk(args.slug, REGION_NAME[args.slug] || "未知");
  }
  if (cmd === "get_prices") {
    return args.slugs.map((s) => mk(s, REGION_NAME[s] || "未知"));
  }
  if (cmd === "list_regions") {
    return Object.entries(REGION_NAME);
  }
  return null;
}

/* 地区表与后端保持一致 */
const REGION_NAME = {
  beijing: "北京",
  shanghai: "上海",
  tianjin: "天津",
  chongqing: "重庆",
  guangdong: "广东",
  shenzhen: "深圳",
  jiangsu: "江苏",
  zhejiang: "浙江",
  shandong: "山东",
  henan: "河南",
  sichuan: "四川",
  hubei: "湖北",
  hunan: "湖南",
  hebei: "河北",
  fujian: "福建",
  anhui: "安徽",
  jiangxi: "江西",
  liaoning: "辽宁",
  shanxi: "山西",
  "shanxi-3": "陕西",
  jilin: "吉林",
  heilongjiang: "黑龙江",
  yunnan: "云南",
  guizhou: "贵州",
  guangxi: "广西",
  gansu: "甘肃",
  hainan: "海南",
  ningxia: "宁夏",
  qinghai: "青海",
  xizang: "西藏",
  xinjiang: "新疆",
  neimenggu: "内蒙古",
};

/**
 * 城市分区：城市选择器按地理大区分组，比平铺 31 项好找。
 */
const CITY_GROUPS = [
  { name: "直辖市", slugs: ["beijing", "shanghai", "tianjin", "chongqing"] },
  { name: "华南", slugs: ["guangdong", "shenzhen", "guangxi", "hainan"] },
  { name: "华东", slugs: ["jiangsu", "zhejiang", "shandong", "anhui", "fujian", "jiangxi"] },
  { name: "华北", slugs: ["hebei", "shanxi", "neimenggu"] },
  { name: "华中", slugs: ["henan", "hubei", "hunan"] },
  { name: "东北", slugs: ["liaoning", "jilin", "heilongjiang"] },
  { name: "西北", slugs: ["shanxi-3", "gansu", "qinghai", "ningxia", "xinjiang"] },
  { name: "西南", slugs: ["sichuan", "yunnan", "guizhou", "xizang"] },
];

/* ===================================================================
 * 主题：dark / light。写到 <html data-theme>，由 CSS 变量整体切换。
 * =================================================================== */
function applyTheme() {
  document.documentElement.setAttribute("data-theme", state.theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", state.theme === "light" ? "#eef1f6" : "#0a0c11");
  }
  // 同步原生状态栏/导航栏图标颜色（浅色主题必须变深，否则看不清）
  try {
    var bridge = window.YoujiaNative;
    if (bridge && typeof bridge.setTheme === "function") {
      bridge.setTheme(state.theme);
    }
  } catch (e) {
    /* 浏览器预览下无此对象，忽略 */
  }
}

function toggleTheme() {
  state.theme = state.theme === "dark" ? "light" : "dark";
  STORE.write("yj.theme", state.theme);
  applyTheme();
  render();
}

const state = {
  current: STORE.read(STORE.current, "beijing"),

  /**
   * 对比列表：
   *   compareList  —— 用户看到并维护的城市列表（有序）
   *   autoSlug     —— 当前「跟随首页」的那个城市。为空表示用户已手动删掉它，
   *                   此时首页再切城市也不会自动加回来。
   *
   * 规则：
   *   1) 首页切换城市时，若 autoSlug 非空，则把旧的跟随项替换为新城市；
   *   2) 用户手动添加到列表的城市永远不动；
   *   3) 用户删掉跟随项后 autoSlug 置空，之后切首页不再插入。
   */
  compareList: STORE.read("yj.compareList", []),
  autoSlug: STORE.read("yj.autoSlug", null),

  cache: STORE.read(STORE.cache, {}),
  history: STORE.read(STORE.history, {}),
  selectedGrade: "92#",
  tab: "home", // home | trend | compare
  loading: true,
  refreshing: false,
  regionSheetOpen: false,
  searchQuery: "",
  theme: STORE.read("yj.theme", "dark"),
  compareGrade: "92#",

  regionSheetOpen: false,
  sheetMode: "home", // home: 选城市后切换首页 | compare: 选城市后加入对比
  calcOpen: false,
  calcMode: "money",
  calcInput: "",
  calcGrade: null,
};

/* ---------- 对比列表的维护逻辑 ---------- */

function saveCompare() {
  STORE.write("yj.compareList", state.compareList);
  STORE.write("yj.autoSlug", state.autoSlug);
}

/** 首页切换城市 → 同步「跟随项」 */
function syncCompareWithCurrent(slug) {
  if (!state.autoSlug) return; // 跟随项已被用户删除，不再自动插入
  if (state.autoSlug === slug) return;

  var idx = state.compareList.indexOf(state.autoSlug);
  if (idx >= 0) {
    state.compareList[idx] = slug;
  } else {
    state.compareList.unshift(slug);
  }
  // 去重（新城市可能已在手动列表里）
  state.compareList = state.compareList.filter(function (s, i, a) {
    return a.indexOf(s) === i;
  });
  state.autoSlug = slug;
  saveCompare();
}

/** 用户从列表里删除某城市 */
function removeCompareCity(slug) {
  state.compareList = state.compareList.filter(function (s) {
    return s !== slug;
  });
  if (state.autoSlug === slug) {
    // 删掉的是跟随项 → 关闭跟随，之后首页切换不影响列表
    state.autoSlug = null;
  }
  saveCompare();
}

/** 用户手动添加城市 */
function addCompareCity(slug) {
  if (state.compareList.indexOf(slug) < 0) {
    state.compareList.push(slug);
  }
  // 手动添加不改变 autoSlug
  saveCompare();
}

/** 初始化：首次使用时把首页当前城市放进列表 */
function initCompareList() {
  if (state.compareList.length === 0) {
    state.compareList = [state.current];
    state.autoSlug = state.current;
    saveCompare();
    return;
  }
  // 兼容老版本：旧数据里没有 autoSlug 字段时，默认跟随首页
  if (state.autoSlug === null && state.compareList.length > 0) {
    // 若列表里已有当前城市，视为跟随它
    if (state.compareList.indexOf(state.current) >= 0) {
      state.autoSlug = state.current;
      saveCompare();
    }
  }
}

/* ===================================================================
 * 历史记录：每次成功拿到价格，把 (日期, 该油品价) 落一条。
 * 同一天只保留最后一次值，避免刷新把曲线打成锯齿。
 * =================================================================== */
function recordHistory(priceData) {
  if (!priceData || !Array.isArray(priceData.fuels)) return;
  const slug = priceData.slug;
  if (!slug) return;
  const day = new Date().toISOString().slice(0, 10);
  const bucket = state.history[slug] || [];

  for (const f of priceData.fuels) {
    // 只在有对应油品时记录
    if (f.grade !== state.selectedGrade) continue;
    const idx = bucket.findIndex((it) => it.d === day && it.g === f.grade);
    const entry = { d: day, g: f.grade, v: f.price, t: Date.now() };
    if (idx >= 0) bucket[idx] = entry;
    else bucket.push(entry);
  }

  // 每天每个油品最多一条，但允许不同油品并存 —— 这里按油品分别存
  bucket.sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  // 只留最近 120 天
  state.history[slug] = bucket.slice(-240);
  STORE.write(STORE.history, state.history);
}

function getSeries(slug, grade) {
  const bucket = state.history[slug] || [];
  return bucket
    .filter((it) => it.g === grade)
    .map((it) => ({ d: it.d, v: it.v }))
    .sort((a, b) => (a.d < b.d ? -1 : 1));
}

/* ===================================================================
 * 数据获取
 * =================================================================== */
async function loadPrice(slug, { silent = false } = {}) {
  if (!silent) state.loading = !state.cache[slug];
  render();

  try {
    const invoke = await getInvoke();
    const data = await invoke("get_price", { slug });
    state.cache[slug] = data;
    recordHistory(data);
    STORE.write(STORE.cache, state.cache);
    state.loading = false;
    state.refreshing = false;
    render();
    return data;
  } catch (e) {
    state.loading = false;
    state.refreshing = false;
    toast(typeof e === "string" ? e : "获取失败，请检查网络");
    render();
    return null;
  }
}

/**
 * 预取所有收藏城市的数据，供「对比」页直接使用。
 * 对比页 = 收藏城市的横向比较，所以数据源就是 favs。
 * 只请求本地缺失的城市，命中缓存时零网络开销。
 */
async function loadCompare() {
  const slugs = state.compareList.filter((s) => !state.cache[s]);
  if (slugs.length === 0) return;
  try {
    const invoke = await getInvoke();
    const list = await invoke("get_prices", { slugs });
    for (const d of list) {
      state.cache[d.slug] = d;
      recordHistory(d);
    }
    STORE.write(STORE.cache, state.cache);
    render();
  } catch {
    /* 对比数据失败不打断主流程 */
  }
}

/* ===================================================================
 * 工具函数
 * =================================================================== */
function fmtPrice(v) {
  return Number(v).toFixed(2);
}

function splitPrice(v) {
  const s = fmtPrice(v);
  const [int, dec] = s.split(".");
  return { int, dec };
}

function timeAgo(ts) {
  if (!ts) return "";
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return "刚刚更新";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

/** 计算某油品的日环比涨跌 */
function deltaFor(slug, grade, currentVal) {
  const series = getSeries(slug, grade);
  if (series.length < 2) return null;
  const prev = series[series.length - 2].v;
  const d = currentVal - prev;
  if (Math.abs(d) < 0.005) return { dir: "flat", val: 0 };
  return { dir: d > 0 ? "up" : "down", val: Math.abs(d) };
}

/** 短促触感反馈（安卓 WebView 支持时） */
function haptic() {
  try {
    if (navigator.vibrate) navigator.vibrate(8);
  } catch {}
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2000);
}

/* ===================================================================
 * 图标（内联 SVG，避免额外网络请求）
 * =================================================================== */
const ICON = {
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3.2-6.9"/><path d="M21 3v6h-6"/></svg>`,
  search: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>`,
  home: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5 12 3l9 7.5"/><path d="M5.5 9.5V20h13V9.5"/></svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19V6"/><path d="M4 19h16"/><path d="M7.5 15.5 11 11l3 2.5 4.5-6"/></svg>`,
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3.5 2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 10l6.1-.9z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
  calc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="2.5" width="15" height="19" rx="3"/><path d="M8.2 6.6h7.6"/><path d="M8.2 11h.01M12 11h.01M15.8 11h.01M8.2 14.6h.01M12 14.6h.01M15.8 14.6h.01M8.2 18.2h.01M12 18.2h.01M15.8 18.2h.01"/></svg>`,
  swap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v13"/><path d="m3.5 13.5 3.5 3.5 3.5-3.5"/><path d="M17 20V7"/><path d="m13.5 10.5 3.5-3.5 3.5 3.5"/></svg>`,
  fuel: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21V5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2v16"/><path d="M3 21h11"/><path d="M6 8h5"/><path d="M13 9h3a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V9l-2-2"/></svg>`,
  empty: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 15s1-1.5 3-1.5 3 1.5 3 1.5"/><path d="M9 9.5h.01M15 9.5h.01"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 14.6A8.6 8.6 0 1 1 9.4 3.5a7 7 0 0 0 11.1 11.1Z"/></svg>`,
  close: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`,
};

/**
 * 油品元数据。cat 用于分组排序与配色：
 *   gas —— 汽油（92/95/98 等）
 *   diesel —— 柴油（0#、-10#、-20#、-35#）
 * name 为显示名，柴油标号后面会跟「(柴油)」。
 */
const GRADE_META = {
  "89#": { cat: "gas", c1: "#8e9aaf", c2: "#68748a" },
  "90#": { cat: "gas", c1: "#8e9aaf", c2: "#68748a" },
  "92#": { cat: "gas", c1: "#4c8dff", c2: "#2f6ee0" },
  "93#": { cat: "gas", c1: "#4c8dff", c2: "#2f6ee0" },
  "95#": { cat: "gas", c1: "#35d3d6", c2: "#1aa8ad" },
  "97#": { cat: "gas", c1: "#35d3d6", c2: "#1aa8ad" },
  "98#": { cat: "gas", c1: "#a97bff", c2: "#7f4fe0" },
  "0#": { cat: "diesel", c1: "#ff9f45", c2: "#e07a1f" },
  "-10#": { cat: "diesel", c1: "#ff8a5b", c2: "#d96a3a" },
  "-20#": { cat: "diesel", c1: "#ff7596", c2: "#d04b6b" },
  "-35#": { cat: "diesel", c1: "#c98bff", c2: "#8d5fd3" },
};

function gradeCat(grade) {
  // 防御：任何非字符串输入都按汽油处理，避免整页渲染中断
  if (typeof grade !== "string" || !grade) return "gas";
  const m = GRADE_META[grade];
  if (m) return m.cat;
  return grade.indexOf("-") === 0 ? "diesel" : "gas";
}

/** 显示名：柴油标号后加「(柴油)」，如 0# → 0# 柴油 */
function gradeLabel(grade) {
  return gradeCat(grade) === "diesel" ? grade + " 柴油" : grade;
}

/** 油品值的数字，用于排序：-35 → -35，0 → 0，92 → 92 */
function gradeNum(grade) {
  const n = parseInt(grade.replace("#", ""), 10);
  return isNaN(n) ? 0 : n;
}

/**
 * 统一排序：汽油在前（按标号升序），柴油在后（按标号降序：0 → -10 → -20 → -35）。
 * 这样最常用的 92# 在最前，柴油按气温适应性由高到低排列，符合加油习惯。
 */
function sortGrades(grades) {
  const list = (grades || []).filter(function (g) {
    return typeof g === "string" && g.length > 0;
  });
  return list.sort(function (a, b) {
    const ca = gradeCat(a) === "gas" ? 0 : 1;
    const cb = gradeCat(b) === "gas" ? 0 : 1;
    if (ca !== cb) return ca - cb;
    const na = gradeNum(a);
    const nb = gradeNum(b);
    return ca === 0 ? na - nb : nb - na;
  });
}

function gradeColorCss(grade) {
  const m = GRADE_META[grade];
  const c1 = m ? m.c1 : "#8e9aaf";
  const c2 = m ? m.c2 : "#68748a";
  return "linear-gradient(180deg," + c1 + "," + c2 + ")";
}

/* ===================================================================
 * 渲染
 * =================================================================== */
// 不能在此处直接取 #app：打包后脚本内联在 <head>，执行时 <body> 尚未解析，
// getElementById 会返回 null，后续 render() 写 innerHTML 就抛 TypeError。
// 改为渲染时按需获取，彻底规避脚本/DOM 时序问题。
let appEl = null;
function getApp() {
  if (appEl && appEl.isConnected) return appEl;
  appEl = document.getElementById("app");
  return appEl;
}

function render() {
  const data = state.cache[state.current];
  const fuels = data?.fuels || [];
  // 当前选中油品若不存在，回退到第一个
  let grade = state.selectedGrade;
  if (fuels.length && !fuels.some((f) => f.grade === grade)) {
    grade = fuels[0].grade;
    state.selectedGrade = grade;
  }
  const active = fuels.find((f) => f.grade === grade) || fuels[0] || null;

  const root = getApp();
  if (!root) return; // DOM 尚未就绪

  // 各页面自己处理滚动容器，避免顶部 chip 区在滚动时被带走
  const body =
    state.tab === "home"
      ? renderHome(data, fuels, active, grade)
      : state.tab === "trend"
      ? renderTrendPage(data, fuels, grade)
      : renderComparePage();

  root.innerHTML = `
    <div class="aurora"></div>
    ${renderTopbar(data)}
    <div class="scroll" id="scrollArea">${body}</div>
    ${renderTabbar()}
    ${renderRegionSheet()}
    ${renderCalcModal()}
    <div class="toast" id="toast"></div>
  `;

  bindEvents();
}

function renderTopbar(data) {
  const cityName = REGION_NAME[state.current] || "选择城市";
  const isLight = state.theme === "light";
  return `
    <div class="topbar">
      <button class="city-btn" id="cityPicker" aria-label="切换城市">
        <span class="city-name">${cityName}</span>
        <svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </button>
      <div class="topbar-actions">
        <button class="icon-btn" id="btnCalc" aria-label="油价计算器">${ICON.calc}</button>
        <button class="icon-btn ${state.refreshing ? "spinning" : ""}" id="btnRefresh"
                aria-label="刷新">${ICON.refresh}</button>
        <button class="icon-btn" id="btnTheme"
                aria-label="切换主题">${isLight ? ICON.moon : ICON.sun}</button>
      </div>
    </div>
    <div class="topbar-sub">
      ${data ? `${REGION_NAME[data.slug] || data.name} · 更新于 ${timeAgo(data.updated_at)}` : "正在获取数据…"}
    </div>
  `;
}
/* ================= 油价主页 ================= */

/**
 * 主视图：全部油品以「方形卡片 + 两列网格」呈现。
 * 卡片本身不可点击选中，只做展示。
 */
function renderHome(data, fuels, active, grade) {
  if (state.loading && !data) {
    return `<div class="fuel-grid">
      <div class="skeleton sk-sq"></div>
      <div class="skeleton sk-sq"></div>
      <div class="skeleton sk-sq"></div>
      <div class="skeleton sk-sq"></div>
    </div>`;
  }

  if (!data || fuels.length === 0) {
    return renderError();
  }

  const ordered = sortGrades(
    fuels.map(function (f) {
      return f.grade;
    })
  );

  return `<div class="home-head">
      <div class="home-city"><i class="pin"></i>${
        REGION_NAME[data.slug] || data.name
      }</div>
      <span class="live-badge"><i class="pulse"></i>LIVE</span>
    </div>

    <div class="fuel-grid">
      ${ordered
        .map(function (g, i) {
          const f = fuels.find(function (x) {
            return x.grade === g;
          });
          if (!f) return "";
          const { int, dec } = splitPrice(f.price);
          const isDiesel = gradeCat(g) === "diesel";
          const delta = deltaFor(data.slug, g, f.price);
          let deltaHtml = "";
          if (delta) {
            const arrow =
              delta.dir === "up" ? "▲" : delta.dir === "down" ? "▼" : "—";
            deltaHtml =
              '<span class="sq-delta ' +
              delta.dir +
              '">' +
              arrow +
              fmtPrice(delta.val) +
              "</span>";
          }
          return `<div class="fuel-square ${
            isDiesel ? "diesel" : ""
          }" style="animation-delay:${i * 45}ms">
            <span class="sq-glow" style="background:${gradeColorCss(g)}"></span>
            <span class="sq-name">${gradeLabel(g)}</span>
            <span class="sq-price">
              <span class="sq-int">${int}</span><span class="sq-dec">.${dec}</span>
            </span>
            <span class="sq-foot">
              <span class="sq-unit">元/升</span>
              ${deltaHtml}
            </span>
          </div>`;
        })
        .join("")}
    </div>

    <div class="home-foot">更新于 ${timeAgo(data.updated_at)} · 省级挂牌价，以加油站为准</div>`;
}

/* ================= 计算器弹窗 ================= */
function renderCalcModal() {
  if (!state.calcOpen) {
    return '<div class="modal-mask" id="calcMask"></div>';
  }

  const data = state.cache[state.current];
  const fuels = (data && data.fuels) || [];
  const ordered = sortGrades(
    fuels.map(function (f) {
      return f.grade;
    })
  );

  let g = state.calcGrade;
  if (ordered.indexOf(g) < 0) g = ordered[0] || state.selectedGrade;
  state.calcGrade = g;

  const picked = fuels.find(function (x) {
    return x.grade === g;
  });
  const price = picked ? picked.price : 0;
  const isMoney = state.calcMode === "money";

  return `<div class="modal-mask open" id="calcMask">
      <div class="modal-panel" id="calcPanel" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>油价计算器</h3>
          <button class="modal-close" id="calcClose" aria-label="关闭">${ICON.close}</button>
        </div>

        <div class="calc-modes">
          <button class="calc-mode ${isMoney ? "active" : ""}" data-calc-mode="money">
            金额 → 升数
          </button>
          <button class="calc-mode ${!isMoney ? "active" : ""}" data-calc-mode="volume">
            升数 → 金额
          </button>
        </div>

        <div class="calc-grades">
          ${ordered
            .map(function (x) {
              return `<button class="calc-chip ${
                x === g ? "active" : ""
              }" data-calc-grade="${x}">${gradeLabel(x)}</button>`;
            })
            .join("")}
        </div>

        <div class="calc-field">
          <label class="cf-label">${isMoney ? "加油金额" : "加油升数"}</label>
          <div class="cf-input-wrap">
            <span class="cf-prefix">${isMoney ? "¥" : "L"}</span>
            <input id="calcInput" class="cf-input" type="text" inputmode="decimal"
                   placeholder="${isMoney ? "100" : "30"}"
                   value="${state.calcInput.replace(/"/g, "&quot;")}" />
          </div>
        </div>

        <div class="calc-output">
          <div class="co-label">${isMoney ? "大约能加" : "大约需要"}</div>
          <div class="co-main">
            <span class="co-num">—</span>
            <span class="co-unit"></span>
          </div>
          <div class="co-formula"></div>
        </div>

        <div class="modal-foot">当前单价 <b id="calcUnitPrice">${fmtPrice(
          price
        )}</b> 元/升 · ${gradeLabel(g)}</div>
      </div>
    </div>`;
}


function renderError() {
  return `<div class="hero">
      <div class="empty" style="padding:28px 10px">
        ${ICON.empty}
        <p>暂时拿不到该城市的油价<br/>点右上角刷新重试</p>
      </div>
    </div>`;
}

/* ================= 趋势页（独立 Tab） ================= */
function renderTrendPage(data, fuels, grade) {
  if (!data || fuels.length === 0) {
    return `<div class="empty" style="padding-top:90px">
        ${ICON.empty}
        <p>还没有数据<br/>回到「油价」页刷新一次</p>
      </div>`;
  }

  const series = getSeries(data.slug, grade);
  const stat = trendStats(series);

  return `<div class="page-title">
      <h2>价格趋势</h2>
      <span class="page-sub">${REGION_NAME[data.slug] || data.name}</span>
    </div>
    ${renderGradeTabs(fuels, grade, "trend")}
    <div class="chart-card">
      <div class="chart-head">
        <span class="t">${gradeLabel(grade)} 走势</span>
        <span class="v">${
          series.length >= 2
            ? series.length +
              " 天 · " +
              fmtPrice(stat.min) +
              " – " +
              fmtPrice(stat.max)
            : series.length + " 个记录点"
        }</span>
      </div>
      ${
        series.length >= 2
          ? renderTrendSvg(series)
          : '<div class="chart-empty">还需要 ' +
            (2 - series.length) +
            ' 天数据才能画曲线<br/><span style="opacity:.7">每次打开应用会自动记录当天油价</span></div>'
      }
    </div>
    ${
      series.length >= 2
        ? `<div class="stat-grid">
      <div class="stat-card"><div class="stat-label">区间最高</div><div class="stat-val">${fmtPrice(
        stat.max
      )}</div></div>
      <div class="stat-card"><div class="stat-label">区间最低</div><div class="stat-val">${fmtPrice(
        stat.min
      )}</div></div>
      <div class="stat-card"><div class="stat-label">累计变化</div><div class="stat-val ${
        stat.net > 0.004 ? "up" : stat.net < -0.004 ? "down" : ""
      }">${stat.net > 0 ? "+" : ""}${fmtPrice(stat.net)}</div></div>
      <div class="stat-card"><div class="stat-label">记录天数</div><div class="stat-val">${
        series.length
      }</div></div>
    </div>`
        : ""
    }`;
}

function trendStats(series) {
  const vals = series.map(function (s) {
    return s.v;
  });
  if (vals.length === 0) return { min: 0, max: 0, net: 0 };
  return {
    min: Math.min.apply(null, vals),
    max: Math.max.apply(null, vals),
    net: vals[vals.length - 1] - vals[0],
  };
}

/* 纯 SVG 曲线，无图表库 */
function renderTrendSvg(series) {
  const W = 320;
  const H = 110;
  const padX = 6;
  const padY = 16;
  const vals = series.map(function (s) {
    return s.v;
  });
  const min = Math.min.apply(null, vals);
  const max = Math.max.apply(null, vals);
  const span = max - min || 0.1;
  const yMin = min - span * 0.18;
  const yMax = max + span * 0.18;

  const px = function (i) {
    return padX + (i * (W - padX * 2)) / Math.max(1, series.length - 1);
  };
  const py = function (v) {
    return padY + ((yMax - v) / (yMax - yMin)) * (H - padY * 2);
  };

  let line = "";
  series.forEach(function (s, i) {
    const x = px(i);
    const y = py(s.v);
    if (i === 0) {
      line += "M " + x.toFixed(2) + " " + y.toFixed(2);
    } else {
      const pxs = px(i - 1);
      const pys = py(series[i - 1].v);
      const cx = (pxs + x) / 2;
      line +=
        " C " +
        cx.toFixed(2) +
        " " +
        pys.toFixed(2) +
        ", " +
        cx.toFixed(2) +
        " " +
        y.toFixed(2) +
        ", " +
        x.toFixed(2) +
        " " +
        y.toFixed(2);
    }
  });

  const area =
    line +
    " L " +
    px(series.length - 1).toFixed(2) +
    " " +
    H +
    " L " +
    px(0).toFixed(2) +
    " " +
    H +
    " Z";

  const first = series[0];
  const last = series[series.length - 1];
  const net = last.v - first.v;
  const color = net > 0.004 ? "#ff5f57" : net < -0.004 ? "#30d158" : "#8e9aaf";
  const dotX = px(series.length - 1).toFixed(2);
  const dotY = py(last.v).toFixed(2);

  const grid = [0.25, 0.5, 0.75]
    .map(function (p) {
      return (
        '<line x1="0" y1="' +
        (H * p).toFixed(1) +
        '" x2="' +
        W +
        '" y2="' +
        (H * p).toFixed(1) +
        '" stroke="currentColor" stroke-opacity="0.07" stroke-width="1"/>'
      );
    })
    .join("");

  return `<svg class="chart-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${color}" stop-opacity="0.30"/>
        <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}
      <path d="${area}" fill="url(#areaGrad)"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"
            vector-effect="non-scaling-stroke"/>
      <circle cx="${dotX}" cy="${dotY}" r="3.4" fill="${color}"/>
      <circle cx="${dotX}" cy="${dotY}" r="7" fill="${color}" opacity="0.22"/>
    </svg>
    <div class="chart-axis"><span>${first.d.slice(
      5
    )}</span><span>${last.d.slice(5)}</span></div>`;
}

/* ================= 油品切换（趋势/对比共用） ================= */
function renderGradeTabs(fuels, active, kind) {
  const ordered = sortGrades(
    fuels.map(function (f) {
      return f.grade;
    })
  );
  // 标号可能多达 6~7 个（92/95/98/0/-10/-20/-35），
  // 横向可滚动，标签只用标号本身以免过长。
  return `<div class="grade-tabs scrollable">${ordered
    .map(function (g) {
      const isDiesel = gradeCat(g) === "diesel";
      return `<button class="grade-tab ${
        g === active ? "active" : ""
      } ${isDiesel ? "diesel" : ""}" data-grade-tab="${g}" data-kind="${kind}">${g}</button>`;
    })
    .join("")}</div>`;
}

/* ================= 对比页 ================= */

/**
 * 城市对比：方形卡片、两列网格，与首页保持同一套卡片语言。
 * 城市来源是 state.compareList（不再有「收藏」概念）：
 *   - 首页选中的城市会自动进入列表并跟随切换；
 *   - 用户手动添加的城市不跟随；
 *   - 用户删掉跟随项后，首页切换不会再把它加回来。
 */
function renderComparePage() {
  const slugs = state.compareList;

  if (slugs.length === 0) {
    return `<div class="page-title">
        <h2>城市对比</h2>
      </div>
      <div class="empty" style="padding-top:60px">
        <p>对比列表为空<br/>点下方按钮添加城市</p>
      </div>
      ${renderAddCityBtn()}`;
  }

  // 触发缺失城市的数据加载
  const missing = slugs.filter(function (s) {
    return !state.cache[s];
  });
  if (missing.length > 0) {
    setTimeout(function () {
      loadCompare();
    }, 0);
  }

  const loaded = slugs
    .map(function (s) {
      return state.cache[s];
    })
    .filter(Boolean);

  // 各城市油品的并集
  const gradeSet = new Set();
  loaded.forEach(function (d) {
    (d.fuels || []).forEach(function (f) {
      gradeSet.add(f.grade);
    });
  });
  const grades = sortGrades(Array.from(gradeSet));

  let grade = state.compareGrade;
  if (grades.indexOf(grade) < 0) grade = grades[0] || "92#";
  state.compareGrade = grade;

  const prices = [];
  slugs.forEach(function (slug) {
    const d = state.cache[slug];
    const f =
      d &&
      (d.fuels || []).find(function (x) {
        return x.grade === grade;
      });
    if (f) prices.push(f.price);
  });
  const min = prices.length ? Math.min.apply(null, prices) : 0;
  const max = prices.length ? Math.max.apply(null, prices) : 0;
  const avg = prices.length
    ? prices.reduce(function (a, b) {
        return a + b;
      }, 0) / prices.length
    : 0;

  const cards = slugs
    .map(function (slug, i) {
      const d = state.cache[slug];
      const f =
        d &&
        (d.fuels || []).find(function (x) {
          return x.grade === grade;
        });
      const name = REGION_NAME[slug] || slug;
      const isAuto = state.autoSlug === slug;
      const isCurrent = state.current === slug;

      // 未加载完成
      if (!f) {
        return `<div class="cmp-card loading" style="animation-delay:${i * 40}ms">
            <span class="cc-glow" style="background:${gradeColorCss(grade)}"></span>
            <div class="cc-top">
              <span class="cc-name">${name}</span>
              <button class="cc-del" data-cmp-del="${slug}" aria-label="移除">${ICON.close}</button>
            </div>
            <div class="cc-price"><span class="cc-loading">—</span></div>
            <div class="cc-foot">加载中…</div>
          </div>`;
      }

      const { int, dec } = splitPrice(f.price);
      const diff = f.price - min;
      let diffText;
      if (prices.length < 2) {
        diffText = "";
      } else if (diff < 0.001) {
        diffText = "当前最低";
      } else {
        diffText = "高 " + fmtPrice(diff) + " 元";
      }

      return `<div class="cmp-card ${isCurrent ? "current" : ""}"
          style="animation-delay:${i * 40}ms">
          <span class="cc-glow" style="background:${gradeColorCss(grade)}"></span>
          <div class="cc-top">
            <span class="cc-name">${name}${
        isAuto ? '<i class="cc-auto" title="跟随首页"></i>' : ""
      }</span>
            <button class="cc-del" data-cmp-del="${slug}" aria-label="移除">${ICON.close}</button>
          </div>
          <div class="cc-price">
            <span class="cc-int">${int}</span><span class="cc-dec">.${dec}</span>
          </div>
          <div class="cc-foot">
            <span class="cc-unit">元/升</span>${diffText ? " · " + diffText : ""}
          </div>
        </div>`;
    })
    .join("");

  return `<div class="page-title">
      <h2>城市对比</h2>
      <span class="page-sub">${slugs.length} 个城市</span>
    </div>

    <div class="grade-tabs">${grades
      .map(function (g) {
        return `<button class="grade-tab ${
          g === grade ? "active" : ""
        }" data-grade-tab="${g}" data-kind="compare">${g}</button>`;
      })
      .join("")}</div>

    <div class="cmp-grid">${cards}</div>

    ${renderAddCityBtn()}`;
}

function renderAddCityBtn() {
  return `<button class="add-city-btn" id="cmpAddCity">+ 添加对比城市</button>`;
}

/* ---- 底部 Tab ---- */
function renderTabbar() {
  const tabs = [
    { id: "home", icon: ICON.home, label: "油价" },
    { id: "trend", icon: ICON.chart, label: "趋势" },
    { id: "compare", icon: ICON.star, label: "对比" },
  ];
  return `<div class="tabbar">${tabs
    .map(function (t) {
      return `<button class="tab ${
        state.tab === t.id ? "active" : ""
      }" data-tab="${t.id}">${t.icon}<span>${t.label}</span></button>`;
    })
    .join("")}</div>`;
}


/* ================= 城市选择面板（重新设计） ================= */
function renderRegionSheet() {
  const q = state.searchQuery.trim().toLowerCase();

  // 搜索时平铺结果；否则按地理大区分组展示
  let content = "";
  if (q) {
    const hits = Object.entries(REGION_NAME).filter(function (kv) {
      return kv[1].indexOf(q) >= 0 || kv[0].indexOf(q) >= 0;
    });
    content = hits.length
      ? '<div class="rgroup"><div class="rgroup-items">' +
        hits
          .map(function (kv) {
            return regionChip(kv[0], kv[1]);
          })
          .join("") +
        "</div></div>"
      : '<div class="empty" style="padding:36px"><p>没有匹配的城市</p></div>';
  } else {
    content = CITY_GROUPS.map(function (g) {
      return `<div class="rgroup">
          <div class="rgroup-label">${g.name}</div>
          <div class="rgroup-items">${g.slugs
            .map(function (s) {
              return regionChip(s, REGION_NAME[s]);
            })
            .join("")}</div>
        </div>`;
    }).join("");
  }

  return `<div class="sheet-mask ${
    state.regionSheetOpen ? "open" : ""
  }" id="sheetMask">
      <div class="sheet">
        <div class="sheet-grip"></div>
        <div class="sheet-head">
          <h3>选择城市</h3>
          <button id="sheetClose">完成</button>
        </div>
        <div class="search-wrap">
          <div class="search-box">
            ${ICON.search}
            <input id="searchInput" placeholder="搜索省份 / 直辖市" value="${q.replace(
              /"/g,
              "&quot;"
            )}" />
          </div>
        </div>
        <div class="region-list" id="regionList">${content}</div>
      </div>
    </div>`;
}

/* 单个城市胶囊：当前城市高亮；已在对比列表中的带小圆点 */
function regionChip(slug, name) {
  const isCur = slug === state.current;
  const inList = state.compareList.indexOf(slug) >= 0;
  return `<button class="rchip ${
    isCur ? "cur" : ""
  } ${inList ? "fav" : ""}" data-region="${slug}">
      <span>${name}</span>
      ${inList ? '<i class="rstar"></i>' : ""}
    </button>`;
}

/* ================= 事件绑定 ================= */
function bindEvents() {
  // 刷新
  // 顶栏的计算器按钮（独立绑定，因为它不在 scrollArea 里）
  var btnCalc = document.getElementById("btnCalc");
  if (btnCalc) {
    btnCalc.addEventListener("click", function () {
      haptic();
      state.calcOpen = true;
      render();
      // 不自动聚焦：等用户点输入框再弹键盘
    });
  }

  var btnRefresh = document.getElementById("btnRefresh");
  if (btnRefresh) {
    btnRefresh.addEventListener("click", async function () {
      haptic();
      state.refreshing = true;
      render();
      await loadPrice(state.current, { silent: true });
      if (state.tab === "compare") loadCompare();
      state.refreshing = false;
      render();
    });
  }

  // 主题切换
  var btnTheme = document.getElementById("btnTheme");
  if (btnTheme) {
    btnTheme.addEventListener("click", function () {
      haptic();
      toggleTheme();
    });
  }

  // 城市选择器
  var cityPicker = document.getElementById("cityPicker");
  if (cityPicker) {
    cityPicker.addEventListener("click", function () {
      haptic();
      state.regionSheetOpen = true;
      state.sheetMode = "home";
      state.searchQuery = "";
      render();
      // 不自动聚焦搜索框：等用户主动点输入框再弹键盘
    });
  }

  // 主滚动区：油品卡 / 对比行 / 取消收藏 / 添加城市
  var scroll = document.getElementById("scrollArea");
  if (scroll) {
    scroll.addEventListener("click", function (e) {
      // 首页卡片不可点击，这里不再处理 data-grade

      var gradeTab = e.target.closest("[data-grade-tab]");
      if (gradeTab) {
        haptic();
        var g = gradeTab.dataset.gradeTab;
        if (gradeTab.dataset.kind === "compare") {
          state.compareGrade = g;
        } else {
          state.selectedGrade = g;
        }
        render();
        return;
      }

      // 对比页：移除城市
      var cmpDel = e.target.closest("[data-cmp-del]");
      if (cmpDel) {
        haptic();
        e.stopPropagation();
        removeCompareCity(cmpDel.dataset.cmpDel);
        render();
        return;
      }


      if (e.target.closest("#cmpAddCity")) {
        haptic();
        state.regionSheetOpen = true;
        state.sheetMode = "compare"; // 选择后加入对比列表
        state.searchQuery = "";
        render();
        // 注意：不自动聚焦搜索框，避免弹窗一出现就弹键盘
        return;
      }

    });
  }

  // Tab 切换
  var tabbar = document.querySelector(".tabbar");
  if (tabbar) {
    tabbar.addEventListener("click", function (e) {
      var tab = e.target.closest("[data-tab]");
      if (!tab) return;
      haptic();
      state.tab = tab.dataset.tab;
      render();
      if (state.tab === "compare") loadCompare();
    });
  }

  // 计算器弹窗：整块委托绑定。
  // 弹窗位于 #calcMask 内（不在 scrollArea 里），必须单独绑定，
  // 否则里面的按钮全部点不动。
  var calcMask = document.getElementById("calcMask");
  if (calcMask) {
    calcMask.addEventListener("click", function (e) {
      if (e.target === calcMask) {
        state.calcOpen = false;
        render();
        return;
      }
      if (e.target.closest("#calcClose")) {
        haptic();
        state.calcOpen = false;
        render();
        return;
      }
      var modeBtn = e.target.closest("[data-calc-mode]");
      if (modeBtn) {
        haptic();
        state.calcMode = modeBtn.dataset.calcMode;
        render();
        updateCalcResult();
        restoreCalcFocus();
        return;
      }
      var chip = e.target.closest("[data-calc-grade]");
      if (chip) {
        haptic();
        state.calcGrade = chip.dataset.calcGrade;
        render(); // 重渲染后结果区是空壳，必须立刻按新单价重算
        updateCalcResult();
        restoreCalcFocus();
        return;
      }
    });

    var ci = document.getElementById("calcInput");
    if (ci) {
      ci.addEventListener("input", function (e) {
        var v = e.target.value;
        v = v.replace(/[^\d.]/g, "");
        var dot = v.indexOf(".");
        if (dot >= 0) {
          v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, "");
        }
        if (v !== e.target.value) e.target.value = v;
        state.calcInput = v;
        updateCalcResult();
      });
    }
  }

  // 城市面板遮罩
  var mask = document.getElementById("sheetMask");
  if (mask) {
    mask.addEventListener("click", function (e) {
      if (e.target === mask || e.target.closest("#sheetClose")) {
        state.regionSheetOpen = false;
        state.searchQuery = "";
        render();
      }
    });
  }

  // 城市面板：点选城市
  var list = document.getElementById("regionList");
  if (list) {
    list.addEventListener("click", function (e) {
      var item = e.target.closest("[data-region]");
      if (!item) return;
      haptic();
      var slug = item.dataset.region;
      state.regionSheetOpen = false;
      state.searchQuery = "";

      if (state.sheetMode === "compare") {
        // 从「对比页 → 添加城市」进入：只加入对比列表，不切换首页
        addCompareCity(slug);
        state.sheetMode = "home";
        render();
      } else {
        switchCity(slug);
      }
    });
  }

  // 搜索框（去抖 120ms）
  var input = document.getElementById("searchInput");
  if (input) {
    var timer = null;
    input.addEventListener("input", function (e) {
      var v = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.searchQuery = v;
        // 只替换列表内容，不重建整个面板。
        // 原先调用 render() 会让 .sheet 重新挂载、动画从 translateY(102%) 重来，
        // 表现就是"面板缩回底部"，被键盘挡住。
        refreshRegionList();
      }, 120);
    });
  }

}

/**
 * 局部刷新城市列表：只重写 #regionList 的 innerHTML。
 * 面板本身、搜索框、输入内容和焦点都保持不变，因此不会被键盘顶掉。
 */
function refreshRegionList() {
  var list = document.getElementById("regionList");
  if (!list) return;
  var q = state.searchQuery.trim().toLowerCase();
  var html = "";

  if (q) {
    var hits = Object.keys(REGION_NAME).filter(function (slug) {
      return REGION_NAME[slug].indexOf(q) >= 0 || slug.indexOf(q) >= 0;
    });
    html = hits.length
      ? '<div class="rgroup"><div class="rgroup-items">' +
        hits
          .map(function (s) {
            return regionChip(s, REGION_NAME[s]);
          })
          .join("") +
        "</div></div>"
      : '<div class="empty" style="padding:36px"><p>没有匹配的城市</p></div>';
  } else {
    html = CITY_GROUPS.map(function (g) {
      return (
        '<div class="rgroup"><div class="rgroup-label">' +
        g.name +
        '</div><div class="rgroup-items">' +
        g.slugs
          .map(function (s) {
            return regionChip(s, REGION_NAME[s]);
          })
          .join("") +
        "</div></div>"
      );
    }).join("");
  }

  list.innerHTML = html;
  list.scrollTop = 0;
}


/**
 * 计算器重渲染后恢复输入框焦点。
 * 切换模式/油品时会 render()，焦点会丢，这里补回来，
 * 但仍不主动唤起键盘（只有在用户已聚焦过输入框时才恢复）。
 */
/**
 * 计算器重渲染后是否恢复输入焦点。
 *
 * 关键：这里**绝不能**调用 el.focus()。
 * 在 Android WebView 里，对 input 调 focus() 会直接弹出软键盘，
 * 表现就是「每切一次油号就弹一次键盘」。
 * 用户只是想换个油品看换算，不需要重新聚焦输入框。
 * 输入内容由 state.calcInput 保留，重新渲染时会通过 value 属性回填。
 */
function restoreCalcFocus() {
  // 不主动聚焦，避免弹键盘。
}

/**
 * 只刷新计算器的结果区（不重建 DOM）。
 * 这样连续输入时焦点不丢，也不触发整页重渲染。
 */
function updateCalcResult() {
  var data = state.cache[state.current];
  var fuels = (data && data.fuels) || [];
  var g = state.calcGrade;
  var picked = fuels.find(function (x) {
    return x.grade === g;
  });
  var price = picked ? picked.price : 0;

  var isMoney = state.calcMode === "money";
  var num = parseFloat(state.calcInput);
  var valid = !isNaN(num) && num > 0 && price > 0;

  var mainEl = document.querySelector(".co-num");
  var unitEl = document.querySelector(".co-unit");
  var formulaEl = document.querySelector(".co-formula");
  if (!mainEl || !unitEl || !formulaEl) return;

  if (!valid) {
    mainEl.textContent = "—";
    unitEl.textContent = "";
    formulaEl.textContent = "输入数字即可换算";
    return;
  }

  if (isMoney) {
    mainEl.textContent = (num / price).toFixed(2);
    unitEl.textContent = "升";
    formulaEl.textContent =
      "¥" + num.toFixed(2) + " ÷ " + fmtPrice(price) + " 元/升";
  } else {
    mainEl.textContent = (num * price).toFixed(2);
    unitEl.textContent = "元";
    formulaEl.textContent =
      num.toFixed(2) + " 升 × " + fmtPrice(price) + " 元/升";
  }
}


function switchCity(slug) {
  state.current = slug;
  STORE.write(STORE.current, slug);
  state.tab = "home";
  // 首页切换 → 同步「跟随项」，让对比页里的城市跟着变
  syncCompareWithCurrent(slug);
  syncCityToWidget(slug);
  loadPrice(slug);
}

/**
 * 把当前城市同步给原生层，供桌面小组件使用。
 * 小组件跑在 AppWidget 进程里，读不到 WebView 的 localStorage，
 * 因此通过 MainActivity 注入的 YoujiaNative 桥接写入 SharedPreferences。
 * 非 Android 环境（浏览器预览）下该对象不存在，静默跳过。
 */
function syncCityToWidget(slug) {
  try {
    var bridge = window.YoujiaNative;
    if (bridge && typeof bridge.setCity === "function") {
      bridge.setCity(slug, REGION_NAME[slug] || slug);
    }
  } catch (e) {
    /* 忽略：不影响主流程 */
  }
}

/* ===================================================================
 * 启动
 * =================================================================== */
/** 出错时把原因显示在屏幕上，而不是只留一片黑——便于真机排障。 */
function showFatal(err) {
  const msg = (err && (err.stack || err.message)) || String(err);
  document.body.innerHTML =
    '<div style="padding:24px;font:12px/1.6 ui-monospace,monospace;color:#ff8a80;' +
    'white-space:pre-wrap;word-break:break-all;background:#0a0c11;min-height:100vh">' +
    '<div style="color:#fff;font:600 15px system-ui;margin-bottom:12px">启动失败</div>' +
    String(msg).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c])) +
    "</div>";
}

async function boot() {
  applyTheme();
  // 初始化对比列表（首次使用时把首页当前城市放进去）
  initCompareList();
  // 启动即把城市同步给桌面小组件，保证首次安装也有正确城市
  syncCityToWidget(state.current);
  try {
    render();
    // 首屏先渲染缓存，用户立刻看到数据（0 网络等待）
    await loadPrice(state.current, { silent: !!state.cache[state.current] });
    // 顺带预取对比列表的数据，切换 tab 时无需再等
    loadCompare();

    // 首屏数据就绪后，如果计算器已打开且有输入，重算一次
    if (state.calcOpen) updateCalcResult();

    // 每 5 分钟自动刷新一次当前城市
    setInterval(function () {
      loadPrice(state.current, { silent: true });
    }, 5 * 60 * 1000);
  } catch (e) {
    showFatal(e);
  }
}

window.addEventListener("error", (e) => {
  if (!document.querySelector(".topbar")) showFatal(e.error || e.message);
});
window.addEventListener("unhandledrejection", (e) => {
  if (!document.querySelector(".topbar")) showFatal(e.reason);
});

// 脚本可能内联在 <head> 中执行，此时 <body> 尚未解析。
// 必须等 DOM 就绪再启动，否则 getElementById("app") 为 null。
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
