use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
                  (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// 缓存有效期：10 分钟。油价一天至多变一次，10 分钟足以保证"实时"体感，
/// 同时避免用户来回切城市时频繁打网络请求导致卡顿。
const CACHE_TTL_SECS: u64 = 600;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Fuel {
    pub grade: String,
    pub price: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProvincePrice {
    pub slug: String,
    pub name: String,
    pub fuels: Vec<Fuel>,
    pub updated_at: u64,
}

pub struct AppCache {
    inner: Mutex<HashMap<String, (u64, ProvincePrice)>>,
    /// 全国柴油表缓存：(时间戳, 省名 -> 标号 -> 价格)
    diesel: Mutex<Option<(u64, HashMap<String, HashMap<String, f64>>)>>,
}

impl AppCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
            diesel: Mutex::new(None),
        }
    }

    /// 取柴油表，命中缓存时直接返回，否则拉取并写入
    async fn diesel_table(
        &self,
        client: &reqwest::Client,
    ) -> HashMap<String, HashMap<String, f64>> {
        let now = now_secs();
        if let Ok(guard) = self.diesel.lock() {
            if let Some((ts, ref map)) = *guard {
                if now.saturating_sub(ts) <= CACHE_TTL_SECS {
                    return map.clone();
                }
            }
        }
        let fresh = fetch_diesel_table(client).await;
        if !fresh.is_empty() {
            if let Ok(mut guard) = self.diesel.lock() {
                *guard = Some((now, fresh.clone()));
            }
        }
        fresh
    }
    fn get(&self, slug: &str) -> Option<ProvincePrice> {
        let now = now_secs();
        let guard = self.inner.lock().ok()?;
        let (ts, val) = guard.get(slug)?;
        if now.saturating_sub(*ts) <= CACHE_TTL_SECS {
            Some(val.clone())
        } else {
            None
        }
    }

    fn put(&self, slug: &str, val: &ProvincePrice) {
        if let Ok(mut guard) = self.inner.lock() {
            guard.insert(slug.to_string(), (now_secs(), val.clone()));
            // 防止长期运行后缓存无限膨胀
            if guard.len() > 64 {
                let now = now_secs();
                guard.retain(|_, (ts, _)| now.saturating_sub(*ts) <= CACHE_TTL_SECS);
            }
        }
    }
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// 31 个省级行政区 + 深圳（独立挂牌），与数据源页面 slug 一一对应。
pub const REGIONS: &[(&str, &str)] = &[
    ("beijing", "北京"),
    ("shanghai", "上海"),
    ("tianjin", "天津"),
    ("chongqing", "重庆"),
    ("guangdong", "广东"),
    ("shenzhen", "深圳"),
    ("jiangsu", "江苏"),
    ("zhejiang", "浙江"),
    ("shandong", "山东"),
    ("henan", "河南"),
    ("sichuan", "四川"),
    ("hubei", "湖北"),
    ("hunan", "湖南"),
    ("hebei", "河北"),
    ("fujian", "福建"),
    ("anhui", "安徽"),
    ("jiangxi", "江西"),
    ("liaoning", "辽宁"),
    ("shanxi", "山西"),
    ("shanxi-3", "陕西"),
    ("jilin", "吉林"),
    ("heilongjiang", "黑龙江"),
    ("yunnan", "云南"),
    ("guizhou", "贵州"),
    ("guangxi", "广西"),
    ("gansu", "甘肃"),
    ("hainan", "海南"),
    ("ningxia", "宁夏"),
    ("qinghai", "青海"),
    ("xizang", "西藏"),
    ("xinjiang", "新疆"),
    ("neimenggu", "内蒙古"),
];

/// 从 `<div id="youjia"> ... </div>` 中以流式单遍状态机提取 (油品名, 价格)。
/// 用状态机而不是正则，是因为 HTML 里嵌套 `</div>` 且各年模板格式不一，
/// 正则回溯会拖慢；状态机 O(n) 且对畸形输入不 panic。
fn parse_youjia_block(html: &str) -> Vec<Fuel> {
    let mut out: Vec<Fuel> = Vec::new();

    let start = match html.find("id=\"youjia\"") {
        Some(i) => i,
        None => return out,
    };
    // 从 id="youjia" 之后开始扫，直到遇上下一个同类容器的开标签为止
    let tail = &html[start..];

    let mut pending_label: Option<String> = None;
    let mut in_dt = false;
    let mut in_dd = false;
    let mut buf = String::with_capacity(64);

    let mut rest = tail;
    loop {
        // 找下一个 '<'，把栈式扫描拆成标签流
        let lt = match rest.find('<') {
            Some(i) => i,
            None => break,
        };
        rest = &rest[lt..];

        let gt = match rest.find('>') {
            Some(i) => i,
            None => break,
        };
        let tag = &rest[1..gt];
        let tag_lc = tag.to_ascii_lowercase();
        rest = &rest[gt + 1..];

        if tag_lc.starts_with("dt") {
            if !tag_lc.starts_with("dt/") {
                in_dt = true;
                in_dd = false;
                buf.clear();
            }
        } else if tag_lc.starts_with("/dt") {
            in_dt = false;
            pending_label = Some(normalize_label(buf.trim()));
            buf.clear();
            // 走到下一个区块（youjiaCont 结束）就收工
        } else if tag_lc.starts_with("dd") {
            if !tag_lc.starts_with("dd/") {
                in_dd = true;
                in_dt = false;
                buf.clear();
            }
        } else if tag_lc.starts_with("/dd") {
            in_dd = false;
            if let Some(label) = pending_label.take() {
                let raw = buf.trim();
                if let Some(price) = parse_price(raw) {
                    // 过滤掉 "0" 这类占位数据（部分城市停售的标号）
                    if price > 0.5 && price < 30.0 {
                        out.push(Fuel {
                            grade: label,
                            price,
                        });
                    }
                }
            }
            buf.clear();
            // 一个 dl 结束，若已收集足够则继续（不提前退出，模板可能有更多油品）
        } else if tag_lc.starts_with("/div") && !out.is_empty() && !in_dt && !in_dd {
            // 已拿到数据且碰到容器收尾
            break;
        } else if tag_lc.starts_with("div") && !out.is_empty() {
            break;
        }
        // 纯文本内容累积（只在我们处于 dt/dd 内时才关心）
        if in_dt || in_dd {
            // rest 现在指向文本开头，取到下一个 '<'
            let next_lt = rest.find('<').unwrap_or(rest.len());
            buf.push_str(&rest[..next_lt]);
            rest = &rest[next_lt..];
        }
    }

    out
}

/// "北京92#汽油" -> "92#"，"广东0#柴油" -> "0#"
fn normalize_label(raw: &str) -> String {
    let bytes: Vec<char> = raw.chars().collect();
    let mut digits = String::new();
    for (i, c) in bytes.iter().enumerate() {
        if c.is_ascii_digit() {
            digits.push(*c);
            if let Some(n) = bytes.get(i + 1) {
                if *n == '#' {
                    return format!("{}#", digits);
                }
            }
        } else if *c == '#' && !digits.is_empty() {
            return format!("{}#", digits);
        } else {
            digits.clear();
        }
    }
    // 兜底：把前缀地名剥掉
    let t = raw.trim();
    t.chars()
        .skip_while(|c| !c.is_ascii_digit())
        .collect::<String>()
}

fn parse_price(raw: &str) -> Option<f64> {
    let cleaned: String = raw
        .chars()
        .filter(|c| c.is_ascii_digit() || *c == '.')
        .collect();
    if cleaned.is_empty() {
        return None;
    }
    cleaned.parse::<f64>().ok()
}

/// 从全国柴油价格表（chaiyou.shtml）中解析出「省名 -> 各标号柴油价」。
///
/// 表格结构：
///   <tr><td>地区</td><td>0号柴油</td><td>-10柴油</td><td>-20柴油</td><td>-35柴油</td></tr>
///   <tr><td>北京</td><td>8.36</td><td>8.86</td><td>9.28</td><td>9.61</td></tr>
/// 停售的标号用 "-" 占位，需跳过。
fn parse_diesel_table(html: &str) -> HashMap<String, HashMap<String, f64>> {
    let mut result: HashMap<String, HashMap<String, f64>> = HashMap::new();

    // 定位柴油表。注意不能用「0号柴油」反查 <table>——
    // 该词先出现在 <title> 里（位置远早于表格），rfind 会找不到。
    // 正确做法：取文档中第一个 <table>，其表头即为柴油价格表。
    let tbl_start = match html.find("<table") {
        Some(t) => t,
        None => return result,
    };
    let tbl_end = match html[tbl_start..].find("</table>") {
        Some(e) => tbl_start + e,
        None => return result,
    };
    let table = &html[tbl_start..tbl_end];

    // 逐行扫描 <tr>
    let mut rest = table;
    let mut header: Vec<String> = Vec::new();
    while let Some(tr_start) = rest.find("<tr") {
        rest = &rest[tr_start..];
        let tr_end = match rest.find("</tr>") {
            Some(e) => e,
            None => break,
        };
        let row = &rest[..tr_end];
        rest = &rest[tr_end..];

        // 取出本行所有单元格的纯文本
        let mut cells: Vec<String> = Vec::new();
        let mut cell_rest = row;
        while let Some(td) = cell_rest.find("<td") {
            cell_rest = &cell_rest[td..];
            // 跳过标签本身，定位到 '>'
            let gt = match cell_rest.find('>') {
                Some(g) => g,
                None => break,
            };
            cell_rest = &cell_rest[gt + 1..];
            let close = cell_rest.find("</td>").unwrap_or(cell_rest.len());
            let raw = strip_tags(&cell_rest[..close]);
            cells.push(raw.trim().to_string());
            if close >= cell_rest.len() {
                break;
            }
            cell_rest = &cell_rest[close..];
        }
        if cells.len() < 2 {
            continue;
        }

        // 第一行是表头：解析出每一列对应的标号
        if header.is_empty() {
            header = cells
                .iter()
                .map(|c| diesel_grade_from_label(c).unwrap_or_default())
                .collect();
            continue;
        }

        let province = cells[0].clone();
        if province.is_empty() {
            continue;
        }
        let mut list: HashMap<String, f64> = HashMap::new();
        for (idx, cell) in cells.iter().enumerate().skip(1) {
            let grade = match header.get(idx) {
                Some(g) if !g.is_empty() => g.clone(),
                _ => continue,
            };
            if let Some(p) = parse_price(cell) {
                if p > 0.5 && p < 30.0 {
                    list.insert(grade, p);
                }
            }
        }
        if !list.is_empty() {
            result.insert(province, list);
        }
    }

    result
}

/// "0号柴油" -> "0#"，"-10柴油" -> "-10#"
fn diesel_grade_from_label(label: &str) -> Option<String> {
    let mut digits = String::new();
    let mut negative = false;
    for c in label.chars() {
        if c == '-' || c == '－' {
            negative = true;
        } else if c.is_ascii_digit() {
            digits.push(c);
        } else if !digits.is_empty() {
            break;
        }
    }
    if digits.is_empty() {
        return None;
    }
    Some(if negative {
        format!("-{}#", digits)
    } else {
        format!("{}#", digits)
    })
}

/// 去掉所有 HTML 标签，保留纯文本
fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
}


/// 数据源统一使用 UTF-8（页面 meta 里明确声明 charset=utf-8）。
/// 早期版本误按 GBK 解码，只靠数字标号兜底才没暴露问题；
/// 涉及中文油品名（如「柴油」）时必须用正确的编码。
fn decode_body(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_string(),
        Err(_) => encoding_rs::GBK.decode(bytes).0.into_owned(),
    }
}

fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .connect_timeout(Duration::from_secs(6))
        .pool_max_idle_per_host(8)
        .tcp_keepalive(Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
}

/// 获取全国柴油价格表（所有城市共用一张表），带 10 分钟缓存。
async fn fetch_diesel_table(client: &reqwest::Client) -> HashMap<String, HashMap<String, f64>> {
    let url = "http://www.qiyoujiage.com/chaiyou.shtml";
    let resp = match client
        .get(url)
        .header(reqwest::header::USER_AGENT, UA)
        .header(reqwest::header::REFERER, "http://www.qiyoujiage.com/")
        .send()
        .await
    {
        Ok(r) => r,
        Err(_) => return HashMap::new(),
    };
    if !resp.status().is_success() {
        return HashMap::new();
    }
    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(_) => return HashMap::new(),
    };
    parse_diesel_table(&decode_body(&bytes))
}

async fn fetch_one(
    client: &reqwest::Client,
    slug: &str,
    name: &str,
    diesel: &HashMap<String, HashMap<String, f64>>,
) -> Result<ProvincePrice, String> {
    let url = format!("http://www.qiyoujiage.com/{}.shtml", slug);
    let resp = client
        .get(&url)
        .header(reqwest::header::USER_AGENT, UA)
        .header(reqwest::header::REFERER, "http://www.qiyoujiage.com/")
        .send()
        .await
        .map_err(|e| format!("{}请求失败: {}", name, e))?;

    if !resp.status().is_success() {
        return Err(format!("{}返回状态码 {}", name, resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("{}读取响应失败: {}", name, e))?;
    let html = decode_body(&bytes);
    let mut fuels = parse_youjia_block(&html);

    if fuels.is_empty() {
        return Err(format!("{}页面结构变化，未解析到油价", name));
    }

    // 用柴油表的负标号（-10#/-20#/-35#）补齐。
    // 省份页只有 0# 柴油，负标号柴油只在全国柴油表里。
    if let Some(row) = diesel.get(name) {
        let mut extras: Vec<Fuel> = Vec::new();
        for (grade, price) in row {
            // 0# 已由省份页提供，这里只补负标号，避免重复
            if grade.starts_with('-') && !fuels.iter().any(|f| &f.grade == grade) {
                extras.push(Fuel {
                    grade: grade.clone(),
                    price: *price,
                });
            }
        }
        // 按标号数值排序：-10 在 -20 前
        extras.sort_by(|a, b| {
            let na = a.grade.trim_start_matches('-').trim_end_matches('#').parse::<i32>().unwrap_or(0);
            let nb = b.grade.trim_start_matches('-').trim_end_matches('#').parse::<i32>().unwrap_or(0);
            nb.cmp(&na)
        });
        fuels.extend(extras);
    }

    Ok(ProvincePrice {
        slug: slug.to_string(),
        name: name.to_string(),
        fuels,
        updated_at: now_secs(),
    })
}
/// 单省查询：先查内存缓存，命中直接返回（0 网络开销、不卡）。
#[tauri::command]
async fn get_price(
    slug: String,
    state: tauri::State<'_, AppCache>,
) -> Result<ProvincePrice, String> {
    if let Some(hit) = state.get(&slug) {
        return Ok(hit);
    }
    let name = REGIONS
        .iter()
        .find(|(s, _)| *s == slug)
        .map(|(_, n)| *n)
        .unwrap_or("未知");

    let client = build_client();
    let diesel = state.diesel_table(&client).await;
    let data = fetch_one(&client, &slug, name, &diesel).await?;
    state.put(&slug, &data);
    Ok(data)
}

/// 批量查询：用于「多城市对比」，并发拉取后按原顺序返回，失败项跳过不阻塞整体。
#[tauri::command]
async fn get_prices(
    slugs: Vec<String>,
    state: tauri::State<'_, AppCache>,
) -> Result<Vec<ProvincePrice>, String> {
    if slugs.is_empty() {
        return Ok(Vec::new());
    }

    // 命中缓存的先捞出来，剩下的再走网络
    let mut cached: HashMap<String, ProvincePrice> = HashMap::new();
    let mut todo: Vec<String> = Vec::new();
    for s in &slugs {
        match state.get(s) {
            Some(v) => {
                cached.insert(s.clone(), v);
            }
            None => todo.push(s.clone()),
        }
    }

    let client = build_client();
    // 全国柴油表所有城市共用，只拉一次
    let diesel = state.diesel_table(&client).await;
    // 并发发出所有请求，总耗时 = 最慢的那个，而不是累加。
    // diesel 是全局表，用 Arc 共享，避免每个任务都深拷贝整张表。
    let diesel = std::sync::Arc::new(diesel);
    let futs = todo.into_iter().map(|slug| {
        let client = client.clone();
        let diesel = diesel.clone();
        async move {
            let name = REGIONS
                .iter()
                .find(|(s, _)| *s == slug)
                .map(|(_, n)| *n)
                .unwrap_or("未知");
            fetch_one(&client, &slug, name, &diesel)
                .await
                .map(|v| (slug, v))
        }
    });
    let results = futures::future::join_all(futs).await;

    for r in results {
        if let Ok((slug, val)) = r {
            state.put(&slug, &val);
            cached.insert(slug, val);
        }
    }


    // 保持调用方给定顺序，缺失项自动略过
    Ok(slugs
        .into_iter()
        .filter_map(|s| cached.remove(&s))
        .collect())
}

#[tauri::command]
fn list_regions() -> Vec<(String, String)> {
    REGIONS
        .iter()
        .map(|(s, n)| (s.to_string(), n.to_string()))
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppCache::new())
        .invoke_handler(tauri::generate_handler![
            get_price,
            get_prices,
            list_regions
        ])
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
