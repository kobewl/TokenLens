//! Explicit project handoffs and decisions. No collectors import conversation bodies.
use chrono::Utc;
use rusqlite::{params, Connection, OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
type Result<T> = std::result::Result<T, String>;
fn db_error(error: rusqlite::Error) -> String {
    match error.sqlite_error_code() {
        Some(rusqlite::ErrorCode::DatabaseBusy | rusqlite::ErrorCode::DatabaseLocked) => {
            "E-BUSY：记忆库忙，请稍后重试".into()
        }
        _ => "E-DB：无法访问项目记忆库，请检查目录权限或恢复备份".into(),
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub root: String,
    pub name: String,
    pub guidance: bool,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: i64,
    pub ts: String,
    pub tool: String,
    pub summary: String,
    pub done: Vec<String>,
    pub next: Vec<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision {
    pub id: i64,
    pub ts: String,
    pub tool: String,
    pub title: String,
    pub rationale: String,
    pub status: String,
    pub superseded_by: Option<i64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub events: Vec<Event>,
    pub decisions: Vec<Decision>,
    pub event_count: i64,
    pub decision_count: i64,
    pub brief: String,
}
#[derive(Debug, Deserialize)]
pub struct HandoffInput {
    pub tool: String,
    pub summary: String,
    #[serde(default)]
    pub done: Vec<String>,
    #[serde(default)]
    pub next: Vec<String>,
}
#[derive(Debug, Deserialize)]
pub struct DecisionInput {
    pub tool: String,
    pub title: String,
    pub rationale: String,
    pub supersedes: Option<i64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult {
    pub id: i64,
    pub warning: Option<String>,
}

pub fn project_root(path: &Path) -> Result<PathBuf> {
    let start = path
        .canonicalize()
        .map_err(|_| "项目目录不存在".to_string())?;
    if !start.is_dir() || start.parent().is_none() {
        return Err("请选择具体的项目目录".into());
    }
    // A .git file is also a repository boundary (worktrees and submodules).
    for parent in start.ancestors() {
        if parent.join(".git").exists() {
            return Ok(parent.to_path_buf());
        }
    }
    Ok(start)
}
pub fn projects(conn: &Connection) -> Result<Vec<Project>> {
    let mut stmt = conn
        .prepare("SELECT root,name,guidance FROM managed_projects ORDER BY name,root")
        .map_err(db_error)?;
    let result = stmt
        .query_map([], |r| {
            Ok(Project {
                root: r.get(0)?,
                name: r.get(1)?,
                guidance: r.get(2)?,
            })
        })
        .map_err(db_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(db_error);
    result
}
pub fn register(conn: &Connection, path: &Path) -> Result<Project> {
    let root = project_root(path)?;
    let name = root
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("项目")
        .to_string();
    let root = root.to_string_lossy().into_owned();
    conn.execute(
        "INSERT OR IGNORE INTO managed_projects(root,name,guidance) VALUES(?1,?2,0)",
        params![root, name],
    )
    .map_err(db_error)?;
    registered(conn, &root)
}
pub fn registered(conn: &Connection, root: &str) -> Result<Project> {
    conn.query_row(
        "SELECT root,name,guidance FROM managed_projects WHERE root=?1",
        [root],
        |r| {
            Ok(Project {
                root: r.get(0)?,
                name: r.get(1)?,
                guidance: r.get(2)?,
            })
        },
    )
    .map_err(|_| "请先添加该项目".into())
}
pub fn forget(conn: &Connection, root: &str) -> Result<()> {
    conn.execute("DELETE FROM managed_projects WHERE root=?1", [root])
        .map_err(db_error)?;
    Ok(())
}
fn file_boundary(root: &Path, target: &Path) -> Result<()> {
    if !root.is_dir() || root.canonicalize().ok().as_deref() != Some(root) {
        return Err("项目目录已移动或不可访问".into());
    }
    if fs::symlink_metadata(root.join(".memory")).is_ok_and(|m| m.file_type().is_symlink())
        || fs::symlink_metadata(target).is_ok_and(|m| m.file_type().is_symlink())
    {
        return Err("E-DB：记忆文件不能是符号链接".into());
    }
    Ok(())
}
fn check_schema(conn: &Connection) -> Result<()> {
    let version = conn
        .query_row(
            "SELECT value FROM meta WHERE key='schema_version'",
            [],
            |r| r.get::<_, String>(0),
        )
        .map_err(db_error)?;
    if version != "1" {
        return Err("E-DB：不支持此记忆库版本，请升级或使用兼容版本".into());
    }
    Ok(())
}
fn open_memory(root: &Path, write: bool) -> Result<Option<Connection>> {
    let path = root.join(".memory/baton.db");
    file_boundary(root, &path)?;
    let exists = path.exists();
    if !exists && !write {
        return Ok(None);
    }
    if write {
        fs::create_dir_all(root.join(".memory"))
            .map_err(|_| "E-DB：无法创建项目记忆目录".to_string())?;
    }
    let mut conn = Connection::open_with_flags(
        &path,
        if write {
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE
        } else {
            OpenFlags::SQLITE_OPEN_READ_ONLY
        },
    )
    .map_err(db_error)?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(db_error)?;
    conn.execute_batch("PRAGMA foreign_keys=ON;")
        .map_err(db_error)?;
    if write {
        conn.execute_batch("PRAGMA journal_mode=WAL;")
            .map_err(db_error)?;
        let tx = conn
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(db_error)?;
        let table_count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
                [],
                |r| r.get(0),
            )
            .map_err(db_error)?;
        if table_count > 0 {
            check_schema(&tx)?;
        }
        tx.execute_batch("
            CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
            INSERT OR IGNORE INTO meta VALUES('schema_version','1');
            CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,ts TEXT NOT NULL,tool TEXT NOT NULL,summary TEXT NOT NULL,done TEXT NOT NULL DEFAULT '[]',next TEXT NOT NULL DEFAULT '[]',session_ref TEXT);
            CREATE TABLE IF NOT EXISTS decisions(id INTEGER PRIMARY KEY AUTOINCREMENT,ts TEXT NOT NULL,tool TEXT NOT NULL,title TEXT NOT NULL,rationale TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','superseded')),superseded_by INTEGER REFERENCES decisions(id));
            CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts DESC);
            CREATE INDEX IF NOT EXISTS idx_decisions_status ON decisions(status,id DESC);
            CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events BEGIN SELECT RAISE(ABORT,'append-only'); END;
            CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events BEGIN SELECT RAISE(ABORT,'append-only'); END;
            CREATE TRIGGER IF NOT EXISTS decisions_immutable BEFORE UPDATE OF id,ts,tool,title,rationale ON decisions BEGIN SELECT RAISE(ABORT,'immutable'); END;").map_err(db_error)?;
        tx.commit().map_err(db_error)?;
    }
    check_schema(&conn)?;
    Ok(Some(conn))
}
fn text(value: &str, min: usize, max: usize, name: &str) -> Result<()> {
    let len = value.chars().count();
    if value.trim().is_empty() || len < min || len > max || value.contains('\0') {
        return Err(format!("E-VALID：{name}须为 {min}–{max} 个字符"));
    }
    Ok(())
}
fn items(values: &[String]) -> Result<()> {
    if values.len() > 50 {
        return Err("E-VALID：清单最多 50 项".into());
    }
    for item in values {
        text(item, 1, 500, "清单条目")?;
    }
    Ok(())
}
fn snapshot_conn(conn: &Connection, query: &str) -> Result<Snapshot> {
    if query.chars().count() > 200 {
        return Err("E-VALID：关键词最多 200 个字符".into());
    }
    let escaped = query
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_");
    let pattern = format!("%{escaped}%");
    let mut stmt=conn.prepare(r#"SELECT id,ts,tool,summary,done,next FROM events WHERE summary LIKE ?1 ESCAPE '\' ORDER BY id DESC LIMIT 50"#).map_err(db_error)?;
    let raw = stmt
        .query_map([&pattern], |r| {
            Ok((
                r.get::<_, i64>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, String>(5)?,
            ))
        })
        .map_err(db_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(db_error)?;
    let mut events = Vec::new();
    for (id, ts, tool, summary, done, next) in raw {
        events.push(Event {
            id,
            ts,
            tool,
            summary,
            done: serde_json::from_str(&done).map_err(|_| "E-DB：交接清单格式损坏".to_string())?,
            next: serde_json::from_str(&next).map_err(|_| "E-DB：交接清单格式损坏".to_string())?,
        });
    }
    let mut stmt=conn.prepare(r#"SELECT id,ts,tool,title,rationale,status,superseded_by FROM decisions WHERE title LIKE ?1 ESCAPE '\' OR rationale LIKE ?1 ESCAPE '\' ORDER BY id DESC LIMIT 10001"#).map_err(db_error)?;
    let decisions = stmt
        .query_map([&pattern], |r| {
            Ok(Decision {
                id: r.get(0)?,
                ts: r.get(1)?,
                tool: r.get(2)?,
                title: r.get(3)?,
                rationale: r.get(4)?,
                status: r.get(5)?,
                superseded_by: r.get(6)?,
            })
        })
        .map_err(db_error)?
        .collect::<std::result::Result<Vec<_>, _>>()
        .map_err(db_error)?;
    if decisions.len() > 10000 {
        return Err("E-DB：决策超过 10,000 条，请归档后再读取".into());
    }
    let event_count = conn
        .query_row("SELECT COUNT(*) FROM events", [], |r| r.get(0))
        .map_err(db_error)?;
    let decision_count = conn
        .query_row("SELECT COUNT(*) FROM decisions", [], |r| r.get(0))
        .map_err(db_error)?;
    let mut snapshot = Snapshot {
        events,
        decisions,
        event_count,
        decision_count,
        brief: String::new(),
    };
    snapshot.brief = render_brief(&snapshot);
    Ok(snapshot)
}
pub fn snapshot(root: &Path, query: &str) -> Result<Snapshot> {
    match open_memory(root, false)? {
        Some(conn) => {
            let tx = conn.unchecked_transaction().map_err(db_error)?;
            let snapshot = snapshot_conn(&tx, query)?;
            tx.commit().map_err(db_error)?;
            Ok(snapshot)
        }
        None => Ok(Snapshot {
            events: vec![],
            decisions: vec![],
            event_count: 0,
            decision_count: 0,
            brief: "全新项目：记录一次交接，让下一个工具接着工作。".into(),
        }),
    }
}
pub fn handoff(root: &Path, input: HandoffInput, guidance: bool) -> Result<WriteResult> {
    text(&input.tool, 1, 80, "工具名")?;
    text(&input.summary, 1, 2000, "交接摘要")?;
    items(&input.done)?;
    items(&input.next)?;
    let conn = open_memory(root, true)?.ok_or("E-DB：无法初始化记忆库")?;
    conn.execute(
        "INSERT INTO events(ts,tool,summary,done,next) VALUES(?1,?2,?3,?4,?5)",
        params![
            Utc::now().to_rfc3339(),
            input.tool,
            input.summary,
            serde_json::to_string(&input.done).map_err(|_| "E-VALID：清单无效")?,
            serde_json::to_string(&input.next).map_err(|_| "E-VALID：清单无效")?
        ],
    )
    .map_err(db_error)?;
    let id = conn.last_insert_rowid();
    drop(conn);
    Ok(WriteResult {
        id,
        warning: rebuild(root, guidance).err(),
    })
}
pub fn add_decision(root: &Path, input: DecisionInput, guidance: bool) -> Result<WriteResult> {
    text(&input.tool, 1, 80, "工具名")?;
    text(&input.title, 1, 500, "决策标题")?;
    if input.supersedes.is_some_and(|id| id < 1) {
        return Err("E-VALID：被取代的决策编号须为正整数".into());
    }
    text(&input.rationale, 1, 2000, "决策理由")?;
    let mut conn = open_memory(root, true)?.ok_or("E-DB：无法初始化记忆库")?;
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    if let Some(old) = input.supersedes {
        let state = tx
            .query_row("SELECT status FROM decisions WHERE id=?1", [old], |r| {
                r.get::<_, String>(0)
            })
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => "E-NOTFOUND：旧决策不存在".into(),
                other => db_error(other),
            })?;
        if state != "active" {
            return Err("E-SUPERSEDED：该决策已失效，请取代当前有效决策".into());
        }
    }
    tx.execute(
        "INSERT INTO decisions(ts,tool,title,rationale) VALUES(?1,?2,?3,?4)",
        params![
            Utc::now().to_rfc3339(),
            input.tool,
            input.title,
            input.rationale
        ],
    )
    .map_err(db_error)?;
    let id = tx.last_insert_rowid();
    if let Some(old) = input.supersedes {
        tx.execute(
            "UPDATE decisions SET status='superseded',superseded_by=?1 WHERE id=?2",
            params![id, old],
        )
        .map_err(db_error)?;
    }
    tx.commit().map_err(db_error)?;
    drop(conn);
    Ok(WriteResult {
        id,
        warning: rebuild(root, guidance).err(),
    })
}
pub fn render_brief(snapshot: &Snapshot) -> String {
    let mut out = String::from("# 项目交接简报\n\n");
    if let Some(event) = snapshot.events.first() {
        out.push_str(&format!(
            "## 最近一次交接\n工具：{} · {}\n\n{}\n\n已完成：\n",
            event.tool, event.ts, event.summary
        ));
        for item in &event.done {
            out.push_str(&format!("- {item}\n"));
        }
        out.push_str("\n下一步：\n");
        for item in &event.next {
            out.push_str(&format!("- {item}\n"));
        }
    } else {
        out.push_str("全新项目：尚未记录交接。\n");
    }
    out.push_str("\n## 当前有效决策\n");
    for d in snapshot.decisions.iter().filter(|d| d.status == "active") {
        out.push_str(&format!("- [D{}] {} —— {}\n", d.id, d.title, d.rationale));
    }
    out.push_str(&format!(
        "\n交接 {} 条 · 决策 {} 条\n",
        snapshot.event_count, snapshot.decision_count
    ));
    out
}
const BEGIN: &str = "<!-- baton:begin -->";
const END: &str = "<!-- baton:end -->";
fn write_atomic(root: &Path, path: &Path, content: &str) -> Result<()> {
    file_boundary(root, path)?;
    let temporary = path.with_extension(format!("tmp-{}", std::process::id()));
    // create_new refuses pre-existing files or symlinks; do not truncate them.
    use std::io::Write;
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temporary)
        .map_err(|_| "无法生成记忆视图临时文件".to_string())?;
    let result = (|| {
        file.write_all(content.as_bytes())
            .map_err(|_| "无法写入记忆视图".to_string())?;
        file.sync_all()
            .map_err(|_| "无法保存记忆视图".to_string())?;
        fs::rename(&temporary, path).map_err(|_| "无法更新记忆视图".to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}
pub fn rebuild(root: &Path, guidance: bool) -> Result<()> {
    let mut conn = open_memory(root, true)?.ok_or("E-DB：无法初始化记忆库")?;
    // Serialize view regeneration across desktop and independent MCP processes.
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(db_error)?;
    let snapshot = snapshot_conn(&tx, "")?;
    let mut view = String::from("<!-- TokenLens / Baton 生成视图；记忆事实存放在 baton.db -->\n");
    view.push_str(&snapshot.brief);
    view.push_str("\n## 最近交接历史\n");
    for e in snapshot.events.iter().take(5) {
        view.push_str(&format!(
            "- #{} · {} · {} · {}\n",
            e.id, e.ts, e.tool, e.summary
        ));
    }
    write_atomic(root, &root.join(".memory/handoff.md"), &view)?;
    if guidance {
        let path = root.join("AGENTS.md");
        file_boundary(root, &path)?;
        let original = if path.exists() {
            if fs::metadata(&path)
                .map_err(|_| "无法读取 AGENTS.md 信息".to_string())?
                .len()
                > 262144
            {
                return Err("AGENTS.md 超过大小限制，已保留原文件".into());
            }
            fs::read_to_string(&path).map_err(|_| "无法读取 AGENTS.md".to_string())?
        } else {
            String::new()
        };
        let block=format!("{BEGIN}\n## 项目记忆（TokenLens / Baton）\n\n开工先调用 current，收工调用 handoff，决策调用 add_decision，查历史调用 search。\n未接 MCP 时读取 .memory/handoff.md。只记录提炼后的进度与决策，不记录密钥、提示词或完整回答。\n{END}");
        let starts: Vec<_> = original.match_indices("<!-- baton:begin").collect();
        let ends: Vec<_> = original.match_indices(END).collect();
        let updated = match (starts.as_slice(), ends.as_slice()) {
            ([], []) => format!(
                "{original}{}{block}\n",
                if original.is_empty() {
                    ""
                } else if original.ends_with('\n') {
                    "\n"
                } else {
                    "\n\n"
                }
            ),
            ([(start, _)], [(end, _)]) if start < end => format!(
                "{}{}{}",
                &original[..*start],
                block,
                &original[*end + END.len()..]
            ),
            _ => return Err("AGENTS.md 标记不完整或重复，已保留原文件；请修复后重建".into()),
        };
        write_atomic(root, &path, &updated)?;
    }
    tx.commit().map_err(db_error)
}

pub fn mcp_config(executable: &Path, root: &str, tool: &str, guidance: bool) -> Result<String> {
    let mut args = vec![
        "--mcp".to_string(),
        "--project".into(),
        root.into(),
        "--tool".into(),
        tool.into(),
    ];
    if guidance {
        args.push("--agents".into());
    }
    if tool == "codex" {
        let command = serde_json::to_string(&executable.to_string_lossy())
            .map_err(|_| "无法生成配置".to_string())?;
        let args = serde_json::to_string(&args).map_err(|_| "无法生成配置".to_string())?;
        Ok(format!(
            "[mcp_servers.tokenlens_baton]\ncommand = {command}\nargs = {args}\n"
        ))
    } else {
        serde_json::to_string_pretty(&serde_json::json!({"mcpServers":{"tokenlens-baton":{"command":executable.to_string_lossy(),"args":args}}})).map_err(|_| "无法生成配置".into())
    }
}
