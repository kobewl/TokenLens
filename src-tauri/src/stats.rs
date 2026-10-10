use std::collections::HashMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use chrono::{DateTime, Duration, Local, NaiveDate};
use rusqlite::{params, Connection, OpenFlags};
use serde_json::Value;

use crate::model::{
    from_additive_input, from_inclusive_input, DayTotal, NamedTotal, Overview, RequestLog,
    SeriesPoint, SourceReport, UsageEvent,
};

/// Per-day totals for the last `days` local calendar days (today included).
/// Uses the same filters and local-day boundaries as [`overview`], so the
/// heatmap, period comparisons and the menu bar agree with the dashboard.
pub fn daily_totals(
    conn: &Connection,
    days: i64,
    app_filter: &str,
    provider_filter: &str,
    model_filter: &str,
) -> Result<Vec<DayTotal>, String> {
    let days = days.clamp(1, 730);
    let now = Local::now();
    let start = local_day_start(now.date_naive() - Duration::days(days - 1))?;
    let mut stmt = conn
        .prepare(
            "SELECT strftime('%Y-%m-%d', timestamp_ms / 1000, 'unixepoch', 'localtime') AS day,
            SUM(total_tokens), COUNT(*), SUM(fresh_input), SUM(output_tokens),
            SUM(cache_read_tokens), SUM(cache_write_tokens)
            FROM usage_events
            WHERE timestamp_ms >= ?1 AND timestamp_ms <= ?2
              AND (?3 = '' OR app = ?3) AND (?4 = '' OR provider = ?4) AND (?5 = '' OR model = ?5)
            GROUP BY day ORDER BY day",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(
            params![
                start,
                now.timestamp_millis(),
                application_name(app_filter),
                provider_filter,
                model_filter
            ],
            |row| {
                Ok(DayTotal {
                    day: row.get(0)?,
                    total_tokens: row.get(1)?,
                    event_count: row.get(2)?,
                    fresh_input: row.get(3)?,
                    output_tokens: row.get(4)?,
                    cache_read_tokens: row.get(5)?,
                    cache_write_tokens: row.get(6)?,
                })
            },
        )
        .map_err(|err| err.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())
}

pub fn refresh(conn: &Connection) -> Result<Vec<SourceReport>, String> {
    let zcode = collect_zcode();
    let codex = collect_codex();
    let claude = collect_claude();
    let gemini = collect_gemini();
    let cursor = collect_cursor();
    let kiro = collect_kiro();
    let mut reports = Vec::new();
    for (source, result) in [
        ("zcode", zcode),
        ("codex", codex),
        ("claude-code", claude),
        ("gemini-cli", gemini),
        ("cursor", cursor),
        ("kiro", kiro),
    ] {
        match result {
            Ok((events, detail)) => {
                let count = crate::db::replace_source(conn, source, &events)?;
                let coverage = if source == "kiro" {
                    "unavailable"
                } else if detail.starts_with("未找到") {
                    "missing"
                } else if source == "cursor" {
                    "partial"
                } else {
                    "counted"
                };
                reports.push(SourceReport {
                    app: source.to_string(),
                    events: count,
                    detail,
                    coverage: coverage.to_string(),
                });
            }
            Err(detail) => reports.push(SourceReport {
                app: source.to_string(),
                events: 0,
                detail,
                coverage: "error".to_string(),
            }),
        }
    }
    let home = home()?;
    for (app, path, detail) in [
        (
            "claude-desktop",
            PathBuf::from("/Applications/Claude.app"),
            "本地未发现可核对的逐次 Token 用量记录",
        ),
        (
            "chatgpt",
            PathBuf::from("/Applications/ChatGPT.app"),
            "桌面应用未提供可读取的本机逐次 Token 用量",
        ),
        (
            "windsurf",
            home.join("Library/Application Support/Windsurf"),
            "本地状态库未发现逐次 Token 字段",
        ),
        (
            "trae",
            home.join("Library/Application Support/Trae"),
            "本地聊天库无法作为普通 SQLite 读取，暂不能核对 Token",
        ),
        (
            "vscode-copilot",
            home.join("Library/Application Support/Code/User/globalStorage/github.copilot-chat"),
            "本地未发现可核对的逐次 Token 用量记录",
        ),
        (
            "antigravity",
            home.join(".gemini/antigravity/conversations"),
            "会话库存在，但没有已核实的 Token 字段映射",
        ),
        (
            "opencode",
            home.join(".config/opencode"),
            "仅发现配置目录，未找到本地用量数据库",
        ),
    ] {
        if path.exists() {
            reports.push(SourceReport {
                app: app.to_string(),
                events: 0,
                detail: detail.to_string(),
                coverage: "unavailable".to_string(),
            });
        }
    }
    Ok(reports)
}

pub fn overview(
    conn: &Connection,
    range: &str,
    app_filter: &str,
    provider_filter: &str,
    model_filter: &str,
) -> Result<Overview, String> {
    let (start_ms, end_ms, bucket_kind, range_key) = selection_range(range)?;

    let tx = conn
        .unchecked_transaction()
        .map_err(|err| err.to_string())?;
    let mut providers = Vec::new();
    let mut models = Vec::new();
    {
        let mut stmt = tx.prepare("SELECT DISTINCT provider, model FROM usage_events WHERE timestamp_ms >= ?1 AND timestamp_ms <= ?2")
            .map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(params![start_ms, end_ms], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })
            .map_err(|err| err.to_string())?;
        let mut provider_set = std::collections::BTreeSet::new();
        let mut model_set = std::collections::BTreeSet::new();
        for row in rows {
            let (provider, model) = row.map_err(|err| err.to_string())?;
            provider_set.insert(provider);
            model_set.insert(model);
        }
        providers.extend(provider_set);
        models.extend(model_set);
    }
    let app_name = application_name(app_filter);
    let undated_count = tx
        .query_row(
            "SELECT COUNT(*) FROM usage_events WHERE timestamp_ms = 0
         AND (?1 = '' OR app = ?1) AND (?2 = '' OR provider = ?2) AND (?3 = '' OR model = ?3)",
            params![app_name, provider_filter, model_filter],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|err| err.to_string())?;
    let filter = "timestamp_ms >= ?1 AND timestamp_ms <= ?2
        AND (?3 = '' OR app = ?3) AND (?4 = '' OR provider = ?4) AND (?5 = '' OR model = ?5)";
    let bucket_sql = if bucket_kind == "hour" {
        "strftime('%H:00', timestamp_ms / 1000, 'unixepoch', 'localtime')"
    } else {
        "CASE WHEN timestamp_ms <= 0 THEN '日期未知' ELSE strftime('%Y-%m-%d', timestamp_ms / 1000, 'unixepoch', 'localtime') END"
    };
    let mut total = NamedTotal::blank();
    let mut by_model = HashMap::new();
    let mut by_app = HashMap::new();
    let mut by_project = HashMap::new();
    let mut by_provider = HashMap::new();
    let mut series: HashMap<(String, String), (i64, i64)> = HashMap::new();
    let mut event_count = 0;
    {
        // Aggregate in SQLite: do not copy and sort every request in Rust for
        // each filter change. Only the latest 200 request rows cross the IPC.
        let sql = format!(
            "SELECT app, model, project, provider, {bucket_sql} AS bucket,
            SUM(fresh_input), SUM(output_tokens), SUM(reasoning_tokens),
            SUM(cache_read_tokens), SUM(cache_write_tokens), SUM(total_tokens), COUNT(*)
            FROM usage_events WHERE {filter} GROUP BY app, model, project, provider, bucket"
        );
        let mut stmt = tx.prepare(&sql).map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(
                params![start_ms, end_ms, app_name, provider_filter, model_filter],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, i64>(5)?,
                        row.get::<_, i64>(6)?,
                        row.get::<_, i64>(7)?,
                        row.get::<_, i64>(8)?,
                        row.get::<_, i64>(9)?,
                        row.get::<_, i64>(10)?,
                        row.get::<_, i64>(11)?,
                    ))
                },
            )
            .map_err(|err| err.to_string())?;
        for row in rows {
            let (
                app,
                model,
                project,
                provider,
                bucket,
                fresh,
                output,
                reasoning,
                cache_read,
                cache_write,
                tokens,
                count,
            ) = row.map_err(|err| err.to_string())?;
            event_count += count;
            add(
                &mut total,
                fresh,
                output,
                reasoning,
                cache_read,
                cache_write,
                tokens,
            );
            for (map, name) in [
                (&mut by_model, &model),
                (&mut by_app, &app),
                (&mut by_project, &project),
                (&mut by_provider, &provider),
            ] {
                add_named(
                    map,
                    name,
                    fresh,
                    output,
                    reasoning,
                    cache_read,
                    cache_write,
                    tokens,
                );
            }
            let point = series.entry((bucket, model)).or_insert((0, 0));
            point.0 += tokens;
            point.1 += count;
        }
    }
    let requests = {
        let sql = format!(
            "SELECT timestamp_ms, app, provider, model, fresh_input, output_tokens,
            cache_read_tokens, cache_write_tokens, total_tokens FROM usage_events WHERE {filter}
            ORDER BY timestamp_ms DESC, request_id DESC LIMIT 200"
        );
        let mut stmt = tx.prepare(&sql).map_err(|err| err.to_string())?;
        let rows = stmt
            .query_map(
                params![start_ms, end_ms, app_name, provider_filter, model_filter],
                |row| {
                    Ok(RequestLog {
                        timestamp_ms: row.get(0)?,
                        app: row.get(1)?,
                        provider: row.get(2)?,
                        model: row.get(3)?,
                        fresh_input: row.get(4)?,
                        output_tokens: row.get(5)?,
                        cache_read_tokens: row.get(6)?,
                        cache_write_tokens: row.get(7)?,
                        total_tokens: row.get(8)?,
                    })
                },
            )
            .map_err(|err| err.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|err| err.to_string())?
    };
    tx.commit().map_err(|err| err.to_string())?;
    let mut series_points: Vec<SeriesPoint> = series
        .into_iter()
        .map(
            |((bucket, model), (total_tokens, event_count))| SeriesPoint {
                bucket,
                model,
                total_tokens,
                event_count,
            },
        )
        .collect();
    series_points.sort_by(|a, b| a.bucket.cmp(&b.bucket).then(a.model.cmp(&b.model)));
    Ok(Overview {
        range: range_key.to_string(),
        range_start_ms: start_ms,
        range_end_ms: end_ms,
        undated_count,
        total_tokens: total.total_tokens,
        fresh_input: total.fresh_input,
        output_tokens: total.output_tokens,
        cache_read_tokens: total.cache_read_tokens,
        cache_write_tokens: total.cache_write_tokens,
        reasoning_tokens: total.reasoning_tokens,
        event_count,
        by_model: sorted(by_model),
        by_app: sorted(by_app),
        by_project: sorted(by_project),
        series: series_points,
        bucket_kind: bucket_kind.to_string(),
        requests,
        providers,
        models,
        by_provider: sorted(by_provider),
    })
}

fn application_name(app: &str) -> &str {
    match app {
        "codex" => "Codex",
        "claude-code" => "Claude Code",
        "gemini-cli" => "Gemini CLI",
        "zcode" => "ZCode",
        "cursor" => "Cursor",
        "kiro" => "Kiro",
        "claude-desktop" => "Claude Desktop",
        "opencode" => "OpenCode",
        other => other,
    }
}
fn selection_range(range: &str) -> Result<(i64, i64, &'static str, &str), String> {
    let now = Local::now();
    let (start, kind) = match range {
        "7d" => (
            local_day_start(now.date_naive() - Duration::days(6))?,
            "day",
        ),
        "30d" => (
            local_day_start(now.date_naive() - Duration::days(29))?,
            "day",
        ),
        "all" => (0, "day"),
        _ => (local_day_start(now.date_naive())?, "hour"),
    };
    let key = if matches!(range, "7d" | "30d" | "all") {
        range
    } else {
        "today"
    };
    Ok((start, now.timestamp_millis(), kind, key))
}

/// Complete filtered metadata export, independent of the UI's latest-200 limit.
/// SQLite selects an explicit allowlist; bodies and credentials are never read.
pub fn export_metadata(
    conn: &Connection,
    range: &str,
    app: &str,
    provider: &str,
    model: &str,
) -> Result<String, String> {
    let (start, end, _, _) = selection_range(range)?;
    let mut stmt = conn.prepare("SELECT request_id,timestamp_ms,app,provider,model,fresh_input,output_tokens,reasoning_tokens,cache_read_tokens,cache_write_tokens,total_tokens,project,session_id,source FROM usage_events
        WHERE timestamp_ms >= ?1 AND timestamp_ms <= ?2 AND (?3 = '' OR app = ?3) AND (?4 = '' OR provider = ?4) AND (?5 = '' OR model = ?5)
        ORDER BY timestamp_ms DESC, request_id DESC LIMIT 100001").map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map(
            params![start, end, application_name(app), provider, model],
            |row| {
                Ok(UsageEvent {
                    request_id: row.get(0)?,
                    timestamp_ms: row.get(1)?,
                    app: row.get(2)?,
                    provider: row.get(3)?,
                    model: row.get(4)?,
                    fresh_input: row.get(5)?,
                    output_tokens: row.get(6)?,
                    reasoning_tokens: row.get(7)?,
                    cache_read_tokens: row.get(8)?,
                    cache_write_tokens: row.get(9)?,
                    total_tokens: row.get(10)?,
                    project: row.get(11)?,
                    session_id: row.get(12)?,
                    source: row.get(13)?,
                })
            },
        )
        .map_err(|err| err.to_string())?;
    let events = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|err| err.to_string())?;
    if events.len() > 100000 {
        return Err("导出超过 100,000 条，请缩小筛选范围".into());
    }
    serde_json::to_string_pretty(&events).map_err(|_| "无法生成用量导出文件".into())
}

type DatabaseStamp = Vec<(PathBuf, Option<(SystemTime, u64)>)>;
struct CachedDatabase {
    stamp: DatabaseStamp,
    events: Vec<UsageEvent>,
    detail: String,
}
/// (last-update time of every Cursor chat with content, newest timestamp of a chat turn that had token counts)
static CURSOR_ACTIVITY: Mutex<(Vec<i64>, i64)> = Mutex::new((Vec::new(), 0));

/// Cursor chats active today / in the last 7 local days. This is activity, never token usage.
pub fn cursor_activity() -> crate::model::CursorActivity {
    let start = |days_back: i64| -> i64 {
        (Local::now().date_naive() - Duration::days(days_back))
            .and_hms_opt(0, 0, 0)
            .and_then(|t| t.and_local_timezone(Local).earliest())
            .map(|t| t.timestamp_millis())
            .unwrap_or(0)
    };
    let (today, week) = (start(0), start(6));
    let guard = CURSOR_ACTIVITY.lock();
    let (chats, last) = guard
        .as_deref()
        .map(|g| (g.0.as_slice(), g.1))
        .unwrap_or((&[], 0));
    crate::model::CursorActivity {
        chats_today: chats.iter().filter(|t| **t >= today).count() as i64,
        chats_week: chats.iter().filter(|t| **t >= week).count() as i64,
        last_counted_ms: last,
    }
}

static DATABASE_CACHE: OnceLock<Mutex<HashMap<PathBuf, CachedDatabase>>> = OnceLock::new();

fn database_stamp(path: &Path) -> DatabaseStamp {
    let mut wal = path.as_os_str().to_os_string();
    wal.push("-wal");
    let mut journal = path.as_os_str().to_os_string();
    journal.push("-journal");
    [
        path.to_path_buf(),
        PathBuf::from(wal),
        PathBuf::from(journal),
    ]
    .into_iter()
    .map(|path| {
        let stamp = fs::metadata(&path)
            .ok()
            .and_then(|meta| meta.modified().ok().map(|time| (time, meta.len())));
        (path, stamp)
    })
    .collect()
}

fn cached_database(
    path: &Path,
    collect: impl FnOnce() -> Result<(Vec<UsageEvent>, String), String>,
) -> Result<(Vec<UsageEvent>, String), String> {
    let before = database_stamp(path);
    let cache = DATABASE_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(entry) = cache.lock().map_err(|err| err.to_string())?.get(path) {
        if entry.stamp == before {
            return Ok((entry.events.clone(), entry.detail.clone()));
        }
    }
    let (events, detail) = collect()?;
    if before == database_stamp(path) {
        cache.lock().map_err(|err| err.to_string())?.insert(
            path.to_path_buf(),
            CachedDatabase {
                stamp: before,
                events: events.clone(),
                detail: detail.clone(),
            },
        );
    }
    Ok((events, detail))
}

fn collect_zcode() -> Result<(Vec<UsageEvent>, String), String> {
    let path = home()?.join(".zcode/cli/db/db.sqlite");
    cached_database(&path, collect_zcode_uncached)
}

fn collect_zcode_uncached() -> Result<(Vec<UsageEvent>, String), String> {
    let path = home()?.join(".zcode/cli/db/db.sqlite");
    if !path.exists() {
        return Ok((Vec::new(), "未找到 ZCode 用量库".to_string()));
    }
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| format!("无法只读打开 ZCode 库: {err}"))?;
    let mut stmt = conn
        .prepare(
            "
            SELECT m.id, m.provider_id, m.model_id, m.started_at,
                   m.input_tokens, m.output_tokens, m.reasoning_tokens,
                   m.cache_creation_input_tokens, m.cache_read_input_tokens,
                   m.session_id, COALESCE(s.directory, '')
            FROM model_usage m
            LEFT JOIN session s ON s.id = m.session_id
            ",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, i64>(7)?,
                row.get::<_, i64>(8)?,
                row.get::<_, String>(9)?,
                row.get::<_, String>(10)?,
            ))
        })
        .map_err(|err| err.to_string())?;
    let mut events = Vec::new();
    for row in rows {
        let (
            id,
            provider,
            model,
            started,
            input,
            output,
            reasoning,
            cache_write,
            cache_read,
            session_id,
            directory,
        ) = row.map_err(|err| err.to_string())?;
        let (fresh, output, reasoning, cache_read, cache_write, total) =
            from_inclusive_input(input, output, reasoning, cache_read, cache_write, None);
        events.push(UsageEvent {
            request_id: format!("zcode:{id}"),
            timestamp_ms: started,
            app: "ZCode".to_string(),
            provider,
            model: blank_model(&model),
            fresh_input: fresh,
            output_tokens: output,
            reasoning_tokens: reasoning,
            cache_read_tokens: cache_read,
            cache_write_tokens: cache_write,
            total_tokens: total,
            project: project_name(&directory),
            session_id,
            source: "zcode".to_string(),
        });
    }
    let detail = format!("只读 model_usage，{} 行", events.len());
    Ok((events, detail))
}

fn collect_codex() -> Result<(Vec<UsageEvent>, String), String> {
    let root = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().unwrap_or_default().join(".codex"));
    let mut files = Vec::new();
    collect_jsonl(&root.join("sessions"), &mut files)?;
    collect_jsonl(&root.join("archived_sessions"), &mut files)?;
    if files.is_empty() {
        return Ok((Vec::new(), "未找到 Codex rollout 日志".to_string()));
    }
    let mut events = Vec::new();
    if let Some(cache) = CODEX_CACHE.get() {
        let current: std::collections::HashSet<_> = files.iter().collect();
        cache
            .lock()
            .map_err(|err| err.to_string())?
            .retain(|path, _| current.contains(path));
    }
    for file in files {
        events.extend(parse_codex_file(&file)?);
    }
    let detail = format!(
        "只采用 token_count.last_token_usage，{} 次调用",
        events.len()
    );
    Ok((events, detail))
}

struct CachedCodex {
    modified: SystemTime,
    size: u64,
    events: Vec<UsageEvent>,
}
static CODEX_CACHE: OnceLock<Mutex<HashMap<PathBuf, CachedCodex>>> = OnceLock::new();

fn parse_codex_file(path: &Path) -> Result<Vec<UsageEvent>, String> {
    let metadata = fs::metadata(path).map_err(|err| err.to_string())?;
    let modified = metadata.modified().map_err(|err| err.to_string())?;
    let cache = CODEX_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Some(entry) = cache.lock().map_err(|err| err.to_string())?.get(path) {
        if entry.modified == modified && entry.size == metadata.len() {
            return Ok(entry.events.clone());
        }
    }
    let events = parse_codex_file_uncached(path)?;
    let after = fs::metadata(path).map_err(|err| err.to_string())?;
    // A live session can append during parsing. Retry it on the next refresh.
    if after.modified().ok() == Some(modified) && after.len() == metadata.len() {
        cache.lock().map_err(|err| err.to_string())?.insert(
            path.to_path_buf(),
            CachedCodex {
                modified,
                size: metadata.len(),
                events: events.clone(),
            },
        );
    }
    Ok(events)
}

fn parse_codex_file_uncached(path: &Path) -> Result<Vec<UsageEvent>, String> {
    let text = read_metadata_file(path)?;
    let file_key = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("rollout")
        .to_string();
    let mut cwd = String::new();
    let mut model = String::new();
    let mut events = Vec::new();
    let mut previous_total: Option<i64> = None;
    for (index, line) in text.lines().enumerate() {
        if !line.contains("token_count")
            && !line.contains("session_meta")
            && !line.contains("turn_context")
        {
            continue;
        }
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        let payload = value.get("payload");
        match kind {
            "session_meta" => {
                if let Some(path) = payload
                    .and_then(|item| item.get("cwd"))
                    .and_then(Value::as_str)
                {
                    cwd = path.to_string();
                }
                if let Some(name) = payload
                    .and_then(|item| item.get("model"))
                    .and_then(Value::as_str)
                {
                    model = name.to_string();
                }
            }
            "turn_context" => {
                if let Some(name) = payload
                    .and_then(|item| item.get("model"))
                    .and_then(Value::as_str)
                {
                    model = name.to_string();
                }
                if cwd.is_empty() {
                    if let Some(path) = payload
                        .and_then(|item| item.get("cwd"))
                        .and_then(Value::as_str)
                    {
                        cwd = path.to_string();
                    }
                }
            }
            "event_msg" => {
                let Some(payload) = payload else { continue };
                if payload.get("type").and_then(Value::as_str) != Some("token_count") {
                    continue;
                }
                let info = payload.get("info").unwrap_or(&Value::Null);
                let cumulative = info
                    .pointer("/total_token_usage/total_tokens")
                    .and_then(Value::as_i64);
                if let Some(current) = cumulative {
                    if let Some(previous) = previous_total {
                        if current <= previous {
                            // A repeated notification carries the same last usage.
                            // A reset cannot be safely treated as a new request.
                            previous_total = Some(current);
                            continue;
                        }
                    }
                    previous_total = Some(current);
                }
                let last = payload
                    .pointer("/info/last_token_usage")
                    .cloned()
                    .unwrap_or(Value::Null);
                if !last.is_object() {
                    continue;
                }
                let input = json_i64(&last, "input_tokens");
                let output = json_i64(&last, "output_tokens");
                let reasoning = json_i64(&last, "reasoning_output_tokens");
                let cache_read = json_i64(&last, "cached_input_tokens");
                let cache_write = json_i64(&last, "cache_write_input_tokens");
                let reported = last.get("total_tokens").and_then(Value::as_i64);
                let (fresh, output, reasoning, cache_read, cache_write, total) =
                    from_inclusive_input(
                        input,
                        output,
                        reasoning,
                        cache_read,
                        cache_write,
                        reported,
                    );
                let ordinal = value
                    .get("ordinal")
                    .and_then(Value::as_i64)
                    .unwrap_or(index as i64);
                let timestamp_ms = value
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .and_then(|text| DateTime::parse_from_rfc3339(text).ok())
                    .map(|time| time.timestamp_millis())
                    .unwrap_or(0);
                events.push(UsageEvent {
                    request_id: format!("codex:{file_key}:{ordinal}"),
                    timestamp_ms,
                    app: "Codex".to_string(),
                    provider: "openai".to_string(),
                    model: blank_model(&model),
                    fresh_input: fresh,
                    output_tokens: output,
                    reasoning_tokens: reasoning,
                    cache_read_tokens: cache_read,
                    cache_write_tokens: cache_write,
                    total_tokens: total,
                    project: project_name(&cwd),
                    session_id: file_key.clone(),
                    source: "codex".to_string(),
                });
            }
            _ => {}
        }
    }
    Ok(events)
}

fn collect_claude() -> Result<(Vec<UsageEvent>, String), String> {
    let root = std::env::var_os("CLAUDE_CONFIG_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().unwrap_or_default().join(".claude"))
        .join("projects");
    let mut files = Vec::new();
    collect_jsonl(&root, &mut files)?;
    if files.is_empty() {
        return Ok((Vec::new(), "未找到 Claude Code 会话日志".to_string()));
    }
    let mut best: HashMap<String, UsageEvent> = HashMap::new();
    for file in &files {
        let project = file
            .parent()
            .and_then(|dir| dir.file_name())
            .and_then(|name| name.to_str())
            .map(decode_claude_project)
            .unwrap_or_else(|| "未知项目".to_string());
        let text = read_metadata_file(file)?;
        for line in text.lines() {
            if !line.contains("\"usage\"") {
                continue;
            }
            let Ok(value) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let Some(message) = value.get("message") else {
                continue;
            };
            let Some(usage) = message.get("usage") else {
                continue;
            };
            let Some(message_id) = message.get("id").and_then(Value::as_str) else {
                continue;
            };
            let request_id = value
                .get("requestId")
                .and_then(Value::as_str)
                .filter(|item| !item.is_empty());
            let key = match request_id {
                Some(id) => format!("{message_id}:{id}"),
                None => message_id.to_string(),
            };
            let input = json_i64(usage, "input_tokens");
            let output = json_i64(usage, "output_tokens");
            let cache_read = json_i64(usage, "cache_read_input_tokens");
            let cache_write = json_i64(usage, "cache_creation_input_tokens");
            let (fresh, output, reasoning, cache_read, cache_write, total) =
                from_additive_input(input, output, cache_read, cache_write);
            let timestamp_ms = value
                .get("timestamp")
                .and_then(Value::as_str)
                .and_then(|text| DateTime::parse_from_rfc3339(text).ok())
                .map(|time| time.timestamp_millis())
                .unwrap_or(0);
            let event = UsageEvent {
                request_id: format!("claude:{key}"),
                timestamp_ms,
                app: "Claude Code".to_string(),
                provider: "anthropic".to_string(),
                model: blank_model(message.get("model").and_then(Value::as_str).unwrap_or("")),
                fresh_input: fresh,
                output_tokens: output,
                reasoning_tokens: reasoning,
                cache_read_tokens: cache_read,
                cache_write_tokens: cache_write,
                total_tokens: total,
                project: value
                    .get("cwd")
                    .and_then(Value::as_str)
                    .filter(|cwd| !cwd.trim().is_empty())
                    .map(project_name)
                    .unwrap_or_else(|| project.clone()),
                session_id: value
                    .get("sessionId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                source: "claude-code".to_string(),
            };
            match best.get(&key) {
                Some(previous) if previous.output_tokens > event.output_tokens => {}
                _ => {
                    best.insert(key, event);
                }
            }
        }
    }
    let count = best.len();
    Ok((
        best.into_values().collect(),
        format!("按 message.id 保留最后一次完整用量，{count} 次调用"),
    ))
}

fn collect_gemini() -> Result<(Vec<UsageEvent>, String), String> {
    let root = home()?.join(".gemini/tmp");
    let Ok(projects) = fs::read_dir(&root) else {
        return Ok((Vec::new(), "未找到 Gemini CLI 会话".to_string()));
    };
    let mut files = Vec::new();
    for project in projects.flatten() {
        let Ok(entries) = fs::read_dir(project.path().join("chats")) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = path
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("");
            if name.starts_with("session-")
                && matches!(
                    path.extension().and_then(|value| value.to_str()),
                    Some("json" | "jsonl")
                )
            {
                files.push(path);
            }
        }
    }
    if files.is_empty() {
        return Ok((Vec::new(), "未找到 Gemini CLI 会话".to_string()));
    }

    let mut best: HashMap<String, UsageEvent> = HashMap::new();
    let mut skipped = 0_i64;
    for file in &files {
        let text = read_metadata_file(file)?;
        let records: Vec<Value> =
            if file.extension().and_then(|value| value.to_str()) == Some("json") {
                serde_json::from_str::<Value>(&text).into_iter().collect()
            } else {
                text.lines()
                    .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                    .collect()
            };
        let file_key = file
            .parent()
            .and_then(Path::parent)
            .and_then(Path::file_name)
            .and_then(|value| value.to_str())
            .unwrap_or("unknown");
        let fallback_session = file
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("session");
        let mut session_id = fallback_session.to_string();
        for record in records {
            if let Some(id) = record.get("sessionId").and_then(Value::as_str) {
                session_id = id.to_string();
            }
            let messages: Vec<&Value> = match record.get("messages").and_then(Value::as_array) {
                Some(items) => items.iter().collect(),
                None => vec![&record],
            };
            for message in messages {
                if message.get("type").and_then(Value::as_str) != Some("gemini") {
                    continue;
                }
                let Some(id) = message.get("id").and_then(Value::as_str) else {
                    skipped += 1;
                    continue;
                };
                let Some(usage) = message.get("tokens") else {
                    continue;
                };
                let input = json_i64(usage, "input");
                let output = json_i64(usage, "output");
                let thoughts = json_i64(usage, "thoughts");
                let tool = json_i64(usage, "tool");
                let cached = json_i64(usage, "cached");
                let reported = json_i64(usage, "total");
                if cached > input || reported == 0 || reported != input + output + thoughts + tool {
                    skipped += 1;
                    continue;
                }
                let timestamp_ms = message
                    .get("timestamp")
                    .and_then(Value::as_str)
                    .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
                    .map(|value| value.timestamp_millis())
                    .unwrap_or(0);
                let key = format!("gemini:{file_key}:{session_id}:{id}");
                let (fresh, output, reasoning, cache_read, cache_write, total) =
                    from_inclusive_input(
                        input + tool,
                        output + thoughts,
                        thoughts,
                        cached,
                        0,
                        Some(reported),
                    );
                let event = UsageEvent {
                    request_id: key.clone(),
                    timestamp_ms,
                    app: "Gemini CLI".to_string(),
                    provider: "google".to_string(),
                    model: blank_model(message.get("model").and_then(Value::as_str).unwrap_or("")),
                    fresh_input: fresh,
                    output_tokens: output,
                    reasoning_tokens: reasoning,
                    cache_read_tokens: cache_read,
                    cache_write_tokens: cache_write,
                    total_tokens: total,
                    project: "未知项目".to_string(),
                    session_id: session_id.clone(),
                    source: "gemini-cli".to_string(),
                };
                if best
                    .get(&key)
                    .is_none_or(|previous| event.total_tokens >= previous.total_tokens)
                {
                    best.insert(key, event);
                }
            }
        }
    }
    let count = best.len();
    Ok((
        best.into_values().collect(),
        format!("{count} 条消息有 Token 用量；跳过 {skipped} 条不完整记录"),
    ))
}

// Never follow nested symlinks: source directories can contain cycles or links
// to unrelated projects. Traversal failures must preserve the last good snapshot.
fn collect_jsonl(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>, depth: usize) -> Result<(), String> {
        if depth > 32 {
            return Err("会话目录层级超过限制，本次未更新该来源".into());
        }
        let entries = match fs::read_dir(dir) {
            Ok(entries) => entries,
            Err(error) if depth == 0 && error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(())
            }
            Err(_) => return Err("无法读取会话目录，本次未更新该来源".into()),
        };
        for entry in entries {
            let entry = entry.map_err(|_| "无法读取会话目录项".to_string())?;
            let kind = entry
                .file_type()
                .map_err(|_| "无法读取会话文件类型".to_string())?;
            if kind.is_dir() {
                walk(&entry.path(), out, depth + 1)?;
            } else if kind.is_file()
                && entry.path().extension().and_then(|ext| ext.to_str()) == Some("jsonl")
            {
                if out.len() >= 20_000 {
                    return Err("会话文件数量超过限制，本次未更新该来源".into());
                }
                out.push(entry.path());
            }
        }
        Ok(())
    }
    walk(dir, out, 0)?;
    out.sort();
    Ok(())
}

fn read_metadata_file(path: &Path) -> Result<String, String> {
    const LIMIT: u64 = 128 * 1024 * 1024;
    let file = fs::File::open(path).map_err(|_| "无法读取会话文件".to_string())?;
    if file
        .metadata()
        .map_err(|_| "无法读取会话文件信息".to_string())?
        .len()
        > LIMIT
    {
        return Err("会话文件超过 128 MiB，本次未更新该来源".into());
    }
    let mut text = String::new();
    file.take(LIMIT + 1)
        .read_to_string(&mut text)
        .map_err(|_| "无法读取会话文件文本".to_string())?;
    if text.len() as u64 > LIMIT {
        return Err("会话文件超过大小限制".into());
    }
    Ok(text)
}

fn json_i64(value: &Value, key: &str) -> i64 {
    value.get(key).and_then(Value::as_i64).unwrap_or(0).max(0)
}

fn home() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .ok_or_else(|| "没有 HOME".to_string())
}

fn project_name(path: &str) -> String {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return "未知项目".to_string();
    }
    Path::new(trimmed)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|name| !name.is_empty())
        .unwrap_or("未知项目")
        .to_string()
}

fn decode_claude_project(name: &str) -> String {
    let trimmed = name.trim_start_matches('-').replace('-', "/");
    project_name(&trimmed)
}

fn blank_model(model: &str) -> String {
    let trimmed = model.trim();
    if trimmed.is_empty() {
        "未知模型".to_string()
    } else {
        trimmed.to_string()
    }
}

fn collect_cursor() -> Result<(Vec<UsageEvent>, String), String> {
    let path = home()?.join("Library/Application Support/Cursor/User/globalStorage/state.vscdb");
    cached_database(&path, collect_cursor_uncached)
}

fn collect_cursor_uncached() -> Result<(Vec<UsageEvent>, String), String> {
    let path = home()?.join("Library/Application Support/Cursor/User/globalStorage/state.vscdb");
    if !path.exists() {
        return Ok((Vec::new(), "未找到 Cursor 数据库".to_string()));
    }
    let conn = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|err| format!("无法只读打开 Cursor 库: {err}"))?;
    conn.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|err| err.to_string())?;

    let mut meta: HashMap<String, CursorComposer> = HashMap::new();
    let mut bubble_time: HashMap<String, i64> = HashMap::new();
    let mut stmt = conn
        .prepare("SELECT key, value FROM cursorDiskKV WHERE key GLOB 'composerData:*'")
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| err.to_string())?;
    for row in rows {
        let Ok((key, raw)) = row else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let id = key
            .split_once(':')
            .map(|(_, rest)| rest)
            .unwrap_or("")
            .to_string();
        if id.is_empty() {
            continue;
        }
        let mut messages = 0;
        if let Some(headers) = value
            .get("fullConversationHeadersOnly")
            .and_then(Value::as_array)
        {
            messages = headers.len();
            for header in headers {
                let Some(bubble_id) = header.get("bubbleId").and_then(Value::as_str) else {
                    continue;
                };
                let stamp = header
                    .get("createdAt")
                    .and_then(json_stamp)
                    .or_else(|| header.get("startedAtMs").and_then(json_stamp));
                if let Some(stamp) = stamp {
                    bubble_time.insert(format!("{id}:{bubble_id}"), stamp);
                }
            }
        }
        meta.insert(
            id,
            CursorComposer {
                updated: value.get("lastUpdatedAt").and_then(json_stamp).unwrap_or(0),
                messages,
                model: value
                    .pointer("/modelConfig/modelName")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                project: value
                    .pointer("/workspaceIdentifier/uri/fsPath")
                    .and_then(Value::as_str)
                    .map(project_name)
                    .unwrap_or_else(|| "Cursor".to_string()),
                context_tokens: value
                    .get("contextTokensUsed")
                    .and_then(json_stamp)
                    .unwrap_or(0),
                had_turn_tokens: false,
            },
        );
    }

    let mut events = Vec::new();
    let mut turn_count = 0_i64;
    let mut undated_turns = 0_i64;
    let mut stmt = conn
        .prepare(
            "SELECT key, value FROM cursorDiskKV
             WHERE key GLOB 'bubbleId:*'
               AND (instr(value, 'inputTokens') > 0 OR instr(value, 'input_tokens') > 0
                    OR instr(value, 'outputTokens') > 0 OR instr(value, 'output_tokens') > 0)",
        )
        .map_err(|err| err.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|err| err.to_string())?;
    for row in rows {
        let Ok((key, raw)) = row else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<Value>(&raw) else {
            continue;
        };
        let usage = value.get("tokenCount").cloned().unwrap_or(Value::Null);
        let input = json_i64(&usage, "input_tokens").max(json_i64(&usage, "inputTokens"));
        let output = json_i64(&usage, "output_tokens").max(json_i64(&usage, "outputTokens"));
        if input == 0 && output == 0 {
            continue;
        }
        let mut parts = key.splitn(3, ':');
        let _prefix = parts.next();
        let composer_id = parts.next().unwrap_or("");
        let bubble_id = parts.next().unwrap_or("");
        let Some(composer) = meta.get_mut(composer_id) else {
            continue;
        };
        composer.had_turn_tokens = true;
        let timestamp_ms = bubble_time
            .get(&format!("{composer_id}:{bubble_id}"))
            .copied()
            .filter(|stamp| *stamp > 0)
            .or_else(|| {
                value
                    .get("createdAt")
                    .and_then(json_stamp)
                    .filter(|stamp| *stamp > 0)
            })
            // clientStartTime is a monotonic elapsed time, not a calendar date.
            // The RPC send timestamp is Unix milliseconds for this request.
            .or_else(|| {
                value
                    .pointer("/timingInfo/clientRpcSendTime")
                    .and_then(json_stamp)
                    .filter(|stamp| *stamp >= 946684800000)
            })
            .unwrap_or(0);
        if timestamp_ms == 0 {
            undated_turns += 1;
        }
        let (fresh, output, reasoning, cache_read, cache_write, total) =
            from_inclusive_input(input, output, 0, 0, 0, None);
        events.push(UsageEvent {
            request_id: format!("cursor:{composer_id}:{bubble_id}"),
            timestamp_ms,
            app: "Cursor".to_string(),
            provider: "cursor".to_string(),
            model: blank_model(&composer.model),
            fresh_input: fresh,
            output_tokens: output,
            reasoning_tokens: reasoning,
            cache_read_tokens: cache_read,
            cache_write_tokens: cache_write,
            total_tokens: total,
            project: composer.project.clone(),
            session_id: composer_id.to_string(),
            source: "cursor".to_string(),
        });
        turn_count += 1;
    }

    // Remember when chats were last active so the UI can say "Cursor was used today,
    // but this version of Cursor stores no per-request tokens" instead of showing nothing.
    let chats: Vec<i64> = meta
        .values()
        .filter(|c| c.updated > 0 && (c.messages > 0 || c.context_tokens > 0))
        .map(|c| c.updated)
        .collect();
    let last_counted_ms = events
        .iter()
        .map(|e| e.timestamp_ms)
        .max()
        .unwrap_or(0)
        .max(0);
    if let Ok(mut guard) = CURSOR_ACTIVITY.lock() {
        *guard = (chats, last_counted_ms);
    }

    let mut context_chats = 0_i64;
    for composer in meta.values() {
        if composer.had_turn_tokens || composer.context_tokens <= 0 || composer.updated <= 0 {
            continue;
        }
        context_chats += 1;
    }
    let newest = if last_counted_ms > 0 {
        DateTime::from_timestamp_millis(last_counted_ms)
            .map(|t| {
                format!(
                    "最近一条带 Token 的记录在 {}，之后的 Cursor 版本不再写入逐条 Token。",
                    t.with_timezone(&Local).format("%Y-%m-%d")
                )
            })
            .unwrap_or_default()
    } else {
        String::new()
    };
    let detail = format!(
        "{turn_count} 次有逐条 Token（{undated_turns} 次日期未知，仅计入全部）；{context_chats} 个对话只有上下文大小，未计入消耗。{newest}"
    );
    Ok((events, detail))
}

struct CursorComposer {
    updated: i64,
    messages: usize,
    model: String,
    project: String,
    context_tokens: i64,
    had_turn_tokens: bool,
}

fn json_stamp(value: &Value) -> Option<i64> {
    value
        .as_i64()
        .or_else(|| value.as_f64().map(|item| item as i64))
        .or_else(|| {
            value
                .as_str()
                .and_then(|text| DateTime::parse_from_rfc3339(text).ok())
                .map(|time| time.timestamp_millis())
        })
}

fn collect_kiro() -> Result<(Vec<UsageEvent>, String), String> {
    let root = std::env::var_os("KIRO_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home().unwrap_or_default().join(".kiro"))
        .join("sessions");
    let mut files = Vec::new();
    collect_jsonl(&root, &mut files)?;
    if files.is_empty() {
        return Ok((Vec::new(), "未找到 Kiro 会话".to_string()));
    }
    let mut turns = 0_i64;
    for file in files
        .iter()
        .filter(|file| file.file_name().and_then(|name| name.to_str()) == Some("messages.jsonl"))
    {
        let text = read_metadata_file(file)?;
        for line in text.lines() {
            if line.contains("\"usage_summary\"") {
                turns += 1;
            }
        }
    }
    Ok((
        Vec::new(),
        format!("{turns} 次调用只记录了 credits，没有 Token 数，所以没有算进合计"),
    ))
}

fn local_day_start(date: NaiveDate) -> Result<i64, String> {
    let midnight = date.and_hms_opt(0, 0, 0).ok_or("invalid local midnight")?;
    midnight
        .and_local_timezone(Local)
        .earliest()
        .map(|time| time.timestamp_millis())
        .ok_or_else(|| "local midnight does not exist".to_string())
}

fn add(
    total: &mut NamedTotal,
    fresh: i64,
    output: i64,
    reasoning: i64,
    cache_read: i64,
    cache_write: i64,
    tokens: i64,
) {
    total.fresh_input += fresh;
    total.output_tokens += output;
    total.reasoning_tokens += reasoning;
    total.cache_read_tokens += cache_read;
    total.cache_write_tokens += cache_write;
    total.total_tokens += tokens;
}

fn add_named(
    map: &mut HashMap<String, NamedTotal>,
    name: &str,
    fresh: i64,
    output: i64,
    reasoning: i64,
    cache_read: i64,
    cache_write: i64,
    tokens: i64,
) {
    let entry = map.entry(name.to_string()).or_insert_with(|| NamedTotal {
        name: name.to_string(),
        ..NamedTotal::blank()
    });
    add(
        entry,
        fresh,
        output,
        reasoning,
        cache_read,
        cache_write,
        tokens,
    );
}

fn sorted(map: HashMap<String, NamedTotal>) -> Vec<NamedTotal> {
    let mut items: Vec<_> = map.into_values().collect();
    items.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then(a.name.cmp(&b.name))
    });
    items
}

impl NamedTotal {
    fn blank() -> Self {
        Self {
            name: String::new(),
            total_tokens: 0,
            fresh_input: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            reasoning_tokens: 0,
        }
    }
}
