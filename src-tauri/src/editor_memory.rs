//! Local native memory discovery. Index metadata automatically; read and aggregate only on demand.
use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Read, Write},
    path::{Path, PathBuf},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
type Result<T> = std::result::Result<T, String>;
const LIMIT: u64 = 512 * 1024;
const MERGE_LIMIT: usize = 1024 * 1024;
const BEGIN: &str = "<!-- tokenlens:memory:begin -->";
const END: &str = "<!-- tokenlens:memory:end -->";
fn hash(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn label(path: &Path) -> String {
    path.file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned()
}
fn now() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub tool: String,
    pub name: String,
    pub path: String,
    pub scope: String,
    pub project: String,
    pub kind: String,
    pub bytes: u64,
    pub modified_ms: u128,
    pub readable: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolReport {
    pub tool: String,
    pub detected: bool,
    pub count: usize,
    pub detail: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub root: String,
    pub name: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub entries: Vec<Entry>,
    pub tools: Vec<ToolReport>,
    pub projects: Vec<Project>,
    pub warnings: Vec<String>,
}
#[derive(Clone)]
struct Source {
    entry: Entry,
    anchor: PathBuf,
    file: PathBuf,
    db_key: Option<String>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Document {
    pub content: String,
    pub fingerprint: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Aggregation {
    pub content: String,
    pub fingerprints: BTreeMap<String, String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    pub id: String,
    pub target: String,
    pub before: String,
    pub after: String,
    pub changed: bool,
}
struct Plan {
    preview: Preview,
    anchor: PathBuf,
    existed: bool,
    sources: Vec<(String, String)>,
}
struct Undo {
    target: PathBuf,
    anchor: PathBuf,
    before: Option<String>,
    after_hash: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncResult {
    pub target: String,
    pub backup: Option<String>,
    pub undo_id: String,
}
#[derive(Default)]
pub struct Index {
    sources: BTreeMap<String, Source>,
    projects: BTreeSet<PathBuf>,
    plans: BTreeMap<String, Plan>,
    undos: BTreeMap<String, Undo>,
    scan_warnings: Vec<String>,
}
// Reject nested symbolic links. Explicitly configured roots are canonicalized once.
fn safe(anchor: &Path, path: &Path) -> Result<()> {
    let relative = path
        .strip_prefix(anchor)
        .map_err(|_| "路径超出扫描目录".to_string())?;
    if fs::symlink_metadata(anchor)
        .map_err(|_| "目录不可访问")?
        .file_type()
        .is_symlink()
    {
        return Err("目录已变更，请重新扫描".into());
    }
    let mut current = anchor.to_path_buf();
    for part in relative.components() {
        if !matches!(part, std::path::Component::Normal(_)) {
            return Err("路径无效".into());
        }
        current.push(part);
        match fs::symlink_metadata(&current) {
            Ok(m) if m.file_type().is_symlink() => return Err("不读取或改写符号链接".into()),
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("路径不可访问".into()),
        }
    }
    Ok(())
}
fn text(anchor: &Path, file: &Path) -> Result<String> {
    safe(anchor, file)?;
    let meta = fs::metadata(file).map_err(|_| "记忆文件不可访问")?;
    if !meta.is_file() || meta.len() > LIMIT {
        return Err("文件超过 512 KiB 或不是普通文件".into());
    }
    let mut bytes = Vec::new();
    fs::File::open(file)
        .map_err(|_| "无法读取记忆文件")?
        .take(LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取失败")?;
    if bytes.len() as u64 > LIMIT {
        return Err("文件超过 512 KiB".into());
    }
    String::from_utf8(bytes).map_err(|_| "文件不是 UTF-8 文本".into())
}
fn dirs(path: &Path) -> Vec<PathBuf> {
    let mut items: Vec<_> = fs::read_dir(path)
        .into_iter()
        .flatten()
        .filter_map(|r| r.ok())
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir() && !t.is_symlink()))
        .map(|e| e.path())
        .take(1024)
        .collect();
    items.sort();
    items
}
fn files(anchor: &Path, dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 || out.len() >= 2048 || safe(anchor, dir).is_err() {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for e in entries.take(2048).flatten() {
        let Ok(t) = e.file_type() else { continue };
        if t.is_symlink() {
            continue;
        }
        if t.is_dir() && !matches!(e.file_name().to_str(), Some(".git" | "node_modules")) {
            files(anchor, &e.path(), depth - 1, out);
        } else if t.is_file()
            && matches!(
                e.path().extension().and_then(|s| s.to_str()),
                Some("md" | "mdc")
            )
        {
            out.push(e.path());
        }
        if out.len() >= 2048 {
            break;
        }
    }
}
fn config_home(home: &Path, key: &str, default: &str) -> PathBuf {
    std::env::var_os(key)
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(default))
}
fn add_root(roots: &mut BTreeSet<PathBuf>, candidate: &Path) {
    if roots.len() >= 512 {
        return;
    }
    if let Ok(p) = candidate.canonicalize() {
        if p.is_dir() && p.parent().is_some() {
            roots.insert(p);
        }
    }
}
fn path_from_uri(value: &str) -> Option<PathBuf> {
    if value.starts_with("file:") {
        url::Url::parse(value).ok()?.to_file_path().ok()
    } else {
        let p = PathBuf::from(value);
        p.is_absolute().then_some(p)
    }
}
fn json_roots(value: &Value, roots: &mut BTreeSet<PathBuf>) {
    match value {
        Value::String(s) => {
            if let Some(p) = path_from_uri(s) {
                add_root(roots, &p);
            }
        }
        Value::Array(a) => {
            for v in a.iter().take(512) {
                json_roots(v, roots)
            }
        }
        Value::Object(m) => {
            for (k, v) in m.iter().take(512) {
                if let Some(p) = path_from_uri(k) {
                    add_root(roots, &p);
                }
                json_roots(v, roots)
            }
        }
        _ => {}
    }
}
fn metadata_roots(anchor: &Path, dir: &Path, roots: &mut BTreeSet<PathBuf>) {
    // Only cwd/session_meta fields are used; conversation content is never retained or returned.
    let mut candidates = Vec::new();
    fn walk(anchor: &Path, dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
        if depth == 0 || out.len() >= 512 || safe(anchor, dir).is_err() {
            return;
        }
        for e in fs::read_dir(dir).into_iter().flatten().take(1024).flatten() {
            let Ok(t) = e.file_type() else { continue };
            if t.is_symlink() {
                continue;
            }
            if t.is_dir() {
                walk(anchor, &e.path(), depth - 1, out)
            } else if e.path().extension().is_some_and(|e| e == "jsonl") {
                out.push(e.path());
            }
            if out.len() >= 512 {
                break;
            }
        }
    }
    walk(anchor, dir, 5, &mut candidates);
    for file in candidates {
        let Ok(f) = fs::File::open(file) else {
            continue;
        };
        for line in BufReader::new(f.take(256 * 1024))
            .lines()
            .take(80)
            .map_while(std::result::Result::ok)
        {
            if !line.contains("\"cwd\"") || line.len() > 64 * 1024 {
                continue;
            }
            if let Ok(v) = serde_json::from_str::<Value>(&line) {
                let cwd = v
                    .get("cwd")
                    .or_else(|| v.get("payload").and_then(|p| p.get("cwd")))
                    .and_then(Value::as_str);
                if let Some(cwd) = cwd {
                    add_root(roots, Path::new(cwd));
                    break;
                }
            }
        }
    }
}
impl Index {
    fn add(
        &mut self,
        tool: &str,
        anchor: &Path,
        file: &Path,
        scope: &str,
        project: &str,
        kind: &str,
    ) {
        if self.sources.len() >= 4096 || safe(anchor, file).is_err() {
            return;
        }
        let Ok(m) = fs::metadata(file) else { return };
        if !m.is_file() {
            return;
        }
        let path = file.to_string_lossy().into_owned();
        let id = hash(format!("{tool}:{path}").as_bytes());
        let entry = Entry {
            id: id.clone(),
            tool: tool.into(),
            name: label(file),
            path,
            scope: scope.into(),
            project: project.into(),
            kind: kind.into(),
            bytes: m.len(),
            modified_ms: m
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0),
            readable: m.len() <= LIMIT,
        };
        self.sources.insert(
            id,
            Source {
                entry,
                anchor: anchor.into(),
                file: file.into(),
                db_key: None,
            },
        );
    }
    fn add_folder(
        &mut self,
        tool: &str,
        anchor: &Path,
        dir: &Path,
        scope: &str,
        project: &str,
        kind: &str,
    ) {
        let mut list = Vec::new();
        if dir.exists() && (safe(anchor, dir).is_err() || fs::read_dir(dir).is_err()) {
            self.scan_warnings.push(format!(
                "无法扫描 {}：目录不可访问或为符号链接",
                dir.display()
            ));
            return;
        }
        files(anchor, dir, 4, &mut list);
        if list.len() >= 2048 {
            self.scan_warnings
                .push(format!("{} 达到文件扫描上限", dir.display()));
        }
        for p in list {
            self.add(tool, anchor, &p, scope, project, kind);
        }
    }
    pub fn scan(&mut self, home: &Path, registered: &[String]) -> Catalog {
        self.sources.clear();
        self.projects.clear();
        self.plans.clear();
        self.scan_warnings.clear();
        let mut warnings = Vec::new();
        let mut detected = BTreeSet::new();
        let claude = config_home(home, "CLAUDE_CONFIG_DIR", ".claude");
        let codex = config_home(home, "CODEX_HOME", ".codex");
        for (tool, base) in [
            ("claude-code", claude.clone()),
            ("codex", codex.clone()),
            ("gemini-cli", home.join(".gemini")),
            ("cursor", home.join(".cursor")),
            ("kiro", home.join(".kiro")),
            ("windsurf", home.join(".codeium/windsurf")),
            ("opencode", home.join(".config/opencode")),
            ("zcode", home.join(".zcode")),
            ("antigravity", home.join(".gemini/antigravity")),
            ("trae", home.join(".trae")),
        ] {
            if base.is_dir() {
                detected.insert(tool.to_string());
            }
        }
        let mut roots = BTreeSet::new();
        for root in registered {
            add_root(&mut roots, Path::new(root));
        }
        if let Ok(c) = claude.canonicalize() {
            self.add(
                "claude-code",
                &c,
                &c.join("CLAUDE.md"),
                "global",
                "全局",
                "rules",
            );
            self.add_folder(
                "claude-code",
                &c,
                &c.join("rules"),
                "global",
                "全局",
                "rules",
            );
            for p in dirs(&c.join("projects")) {
                self.add_folder(
                    "claude-code",
                    &c,
                    &p.join("memory"),
                    "project",
                    &label(&p),
                    "memory",
                );
            }
            metadata_roots(&c, &c.join("projects"), &mut roots);
        }
        if let Ok(c) = codex.canonicalize() {
            for name in ["AGENTS.md", "AGENTS.override.md"] {
                self.add("codex", &c, &c.join(name), "global", "全局", "rules");
            }
            self.add_folder("codex", &c, &c.join("memories"), "global", "全局", "memory");
            metadata_roots(&c, &c.join("sessions"), &mut roots);
            for path in fs::read_dir(&c)
                .into_iter()
                .flatten()
                .flatten()
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name().is_some_and(|n| {
                        n.to_string_lossy().starts_with("state_")
                            && n.to_string_lossy().ends_with(".sqlite")
                    })
                })
                .take(4)
            {
                if safe(&c, &path).is_ok() {
                    if let Ok(db) =
                        Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                    {
                        let _ = db.busy_timeout(Duration::from_millis(100));
                        if let Ok(mut s) = db.prepare("SELECT DISTINCT cwd FROM threads LIMIT 512")
                        {
                            if let Ok(rows) = s.query_map([], |r| r.get::<_, String>(0)) {
                                for p in rows.flatten() {
                                    add_root(&mut roots, Path::new(&p));
                                }
                            }
                        }
                    }
                }
            }
        }
        for (tool, base, file, folder) in [
            ("gemini-cli", ".gemini", "GEMINI.md", ""),
            ("kiro", ".kiro", "", "steering"),
            ("windsurf", ".codeium/windsurf", "", "memories"),
            ("opencode", ".config/opencode", "AGENTS.md", ""),
            ("cursor", ".cursor", "", "rules"),
            ("trae", ".trae", "", "rules"),
        ] {
            if let Ok(base) = home.join(base).canonicalize() {
                if !file.is_empty() {
                    self.add(tool, &base, &base.join(file), "global", "全局", "rules");
                }
                if !folder.is_empty() {
                    self.add_folder(
                        tool,
                        &base,
                        &base.join(folder),
                        "global",
                        "全局",
                        if tool == "windsurf" {
                            "memory"
                        } else {
                            "rules"
                        },
                    );
                }
            }
        }
        if let Ok(s) = text(home, &home.join(".gemini/projects.json")) {
            if let Ok(v) = serde_json::from_str::<Value>(&s) {
                json_roots(&v, &mut roots);
            }
        }
        let zdb = home.join(".zcode/cli/db/db.sqlite");
        if safe(home, &zdb).is_ok() {
            if let Ok(db) = Connection::open_with_flags(zdb, OpenFlags::SQLITE_OPEN_READ_ONLY) {
                let _ = db.busy_timeout(Duration::from_millis(100));
                if let Ok(mut s) = db.prepare("SELECT DISTINCT directory FROM session LIMIT 512") {
                    if let Ok(rows) = s.query_map([], |r| r.get::<_, String>(0)) {
                        for p in rows.flatten() {
                            add_root(&mut roots, Path::new(&p));
                        }
                    }
                }
            }
        }
        for (tool, app) in [
            ("cursor", "Cursor"),
            ("windsurf", "Windsurf"),
            ("vscode-copilot", "Code"),
            ("kiro", "Kiro"),
            ("trae", "Trae"),
            ("antigravity", "Antigravity"),
        ] {
            for base in [
                home.join(format!("Library/Application Support/{app}/User")),
                home.join(format!(".config/{app}/User")),
            ] {
                if !base.is_dir() {
                    continue;
                }
                detected.insert(tool.into());
                for dir in dirs(&base.join("workspaceStorage")) {
                    let file = dir.join("workspace.json");
                    if let Ok(s) = text(home, &file) {
                        if let Ok(v) = serde_json::from_str::<Value>(&s) {
                            json_roots(&v, &mut roots);
                        }
                    }
                }
                if tool == "cursor" {
                    let db_path = base.join("globalStorage/state.vscdb");
                    if safe(home, &db_path).is_ok() {
                        if let Ok(db) =
                            Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
                        {
                            let _ = db.busy_timeout(Duration::from_millis(100));
                            if let Ok(bytes) = db.query_row(
                                "SELECT length(CAST(value AS BLOB)) FROM ItemTable WHERE key='aicontext.personalContext'",
                                [],
                                |r| r.get::<_, u64>(0),
                            ) {
                                let id = hash(format!("cursor:{}:aicontext.personalContext", db_path.display()).as_bytes());
                                let entry = Entry {
                                    id: id.clone(), tool: tool.into(), name: "用户规则".into(),
                                    path: format!("{} · aicontext.personalContext", db_path.display()),
                                    scope: "global".into(), project: "全局".into(), kind: "rules".into(),
                                    bytes, modified_ms: 0, readable: bytes <= LIMIT,
                                };
                                self.sources.insert(id, Source {
                                    entry, anchor: home.into(), file: db_path,
                                    db_key: Some("aicontext.personalContext".into()),
                                });
                            }
                        }
                    }
                }
            }
        }
        for container in [
            "Projects",
            "projects",
            "Developer",
            "Code",
            "code",
            "Documents/GitHub",
        ] {
            let base = home.join(container);
            for dir in dirs(&base) {
                if roots.len() >= 512 {
                    break;
                }
                add_root(&mut roots, &dir);
                for sub in dirs(&dir) {
                    if roots.len() >= 512 {
                        break;
                    }
                    if sub.join(".git").exists() {
                        add_root(&mut roots, &sub);
                    }
                }
            }
        }
        for root in roots {
            let project = label(&root);
            let before = self.sources.len();
            for (tool, name) in [
                ("shared", "AGENTS.md"),
                ("shared", "AGENTS.override.md"),
                ("claude-code", "CLAUDE.md"),
                ("claude-code", "CLAUDE.local.md"),
                ("claude-code", ".claude/CLAUDE.md"),
                ("gemini-cli", "GEMINI.md"),
                ("cursor", ".cursorrules"),
                ("vscode-copilot", ".github/copilot-instructions.md"),
            ] {
                self.add(tool, &root, &root.join(name), "project", &project, "rules");
            }
            for (tool, folder) in [
                ("claude-code", ".claude/rules"),
                ("cursor", ".cursor/rules"),
                ("kiro", ".kiro/steering"),
                ("windsurf", ".windsurf/rules"),
                ("vscode-copilot", ".github/instructions"),
                ("antigravity", ".agent/rules"),
                ("trae", ".trae/rules"),
            ] {
                self.add_folder(
                    tool,
                    &root,
                    &root.join(folder),
                    "project",
                    &project,
                    "rules",
                );
            }
            // Every known recent project can be a sync target even if it has no rules yet.
            self.projects.insert(root);
            if self.sources.len() > before {
                for source in self.sources.values().filter(|s| s.entry.project == project) {
                    detected.insert(source.entry.tool.clone());
                }
            }
        }
        if self.sources.len() >= 4096 || self.projects.len() >= 512 {
            warnings.push("扫描达到数量上限，可添加具体项目目录继续定位。".into());
        }
        let tools = [
            "claude-code",
            "codex",
            "cursor",
            "gemini-cli",
            "kiro",
            "windsurf",
            "opencode",
            "vscode-copilot",
            "zcode",
            "antigravity",
            "trae",
            "shared",
        ]
        .into_iter()
        .map(|tool| {
            let count = self
                .sources
                .values()
                .filter(|s| s.entry.tool == tool)
                .count();
            ToolReport {
                tool: tool.into(),
                detected: detected.contains(tool) || count > 0,
                count,
                detail: if tool == "zcode" {
                    "当前只用于发现最近项目；私有记忆格式待适配".into()
                } else if tool == "cursor" {
                    "本机用户规则与项目规则；云端 Memories 暂未适配".into()
                } else if count > 0 {
                    "已发现本机记忆 / 规则文件".into()
                } else {
                    "未发现可读取的本机记忆文件".into()
                },
            }
        })
        .collect();
        warnings.append(&mut self.scan_warnings);
        Catalog {
            entries: self.sources.values().map(|s| s.entry.clone()).collect(),
            tools,
            projects: self
                .projects
                .iter()
                .map(|p| Project {
                    root: p.to_string_lossy().into_owned(),
                    name: label(p),
                })
                .collect(),
            warnings,
        }
    }
    pub fn read(&self, id: &str) -> Result<Document> {
        let s = self
            .sources
            .get(id)
            .ok_or("文件不在当前扫描结果中，请重新扫描")?;
        let content = if let Some(key) = &s.db_key {
            safe(&s.anchor, &s.file)?;
            let db = Connection::open_with_flags(&s.file, OpenFlags::SQLITE_OPEN_READ_ONLY)
                .map_err(|_| "无法读取用户规则库")?;
            db.busy_timeout(Duration::from_millis(200))
                .map_err(|_| "用户规则库忙")?;
            let raw: String = db
                .query_row(
                    "SELECT value FROM ItemTable WHERE key=?1 AND length(CAST(value AS BLOB))<=?2",
                    rusqlite::params![key, LIMIT],
                    |r| r.get(0),
                )
                .map_err(|_| "用户规则不存在或过大")?;
            serde_json::from_str::<Value>(&raw)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or(raw)
        } else {
            text(&s.anchor, &s.file)?
        };
        Ok(Document {
            fingerprint: hash(content.as_bytes()),
            content,
        })
    }
    pub fn aggregate(&self, ids: &[String]) -> Result<Aggregation> {
        if ids.is_empty() || ids.len() > 20 {
            return Err("请选择 1–20 份记忆".into());
        }
        let mut out = String::from("# 选中的编辑器记忆\n\n按来源保留原文；规则冲突由你审阅。\n");
        let mut fingerprints = BTreeMap::new();
        let mut seen = BTreeSet::new();
        for id in ids {
            if !seen.insert(id) {
                continue;
            }
            let source = self.sources.get(id).ok_or("请重新扫描")?;
            let doc = self.read(id)?;
            fingerprints.insert(id.clone(), doc.fingerprint.clone());
            out.push_str(&format!(
                "\n## {} / {} / {}\n\n{}\n",
                source.entry.tool,
                source.entry.project,
                source.entry.name,
                doc.content.replace(BEGIN, "").replace(END, "")
            ));
            if out.len() > MERGE_LIMIT {
                return Err("汇总超过 1 MiB，请减少选择".into());
            }
        }
        Ok(Aggregation {
            content: out,
            fingerprints,
        })
    }
    pub fn preview(
        &mut self,
        ids: &[String],
        root: &str,
        tool: &str,
        content: &str,
        allow_agents: bool,
        fingerprints: &BTreeMap<String, String>,
    ) -> Result<Preview> {
        if content.trim().is_empty() || content.len() > MERGE_LIMIT {
            return Err("同步内容为空或超过 1 MiB".into());
        }
        let anchor = PathBuf::from(root);
        if !self.projects.contains(&anchor) {
            return Err("目标项目不在扫描结果中".into());
        }
        let (relative, header) = match tool {
            "claude-code" => (".claude/rules/tokenlens-memory.md", ""),
            "cursor" => (
                ".cursor/rules/tokenlens-memory.mdc",
                "---\ndescription: Shared memory selected in TokenLens\nalwaysApply: true\n---\n\n",
            ),
            "gemini-cli" => ("GEMINI.md", ""),
            "kiro" => (
                ".kiro/steering/tokenlens-memory.md",
                "---\ninclusion: always\n---\n\n",
            ),
            "windsurf" => (
                ".windsurf/rules/tokenlens-memory.md",
                "---\ntrigger: always_on\n---\n\n",
            ),
            "vscode-copilot" => (".github/copilot-instructions.md", ""),
            "codex" | "opencode" => {
                if !allow_agents {
                    return Err("请明确允许更新当前项目的 AGENTS.md 标记块".into());
                }
                ("AGENTS.md", "")
            }
            _ => return Err("目标工具暂不支持写入".into()),
        };
        let target = anchor.join(relative);
        safe(&anchor, &target)?;
        let existed = target.exists();
        if fs::metadata(&target).is_ok_and(|m| m.permissions().readonly()) {
            return Err("目标文件为只读，请先调整权限".into());
        }
        let before = if existed {
            text(&anchor, &target)?
        } else {
            String::new()
        };
        let cleaned = content.replace(BEGIN, "").replace(END, "");
        let block = format!("{BEGIN}\n{}\n{END}", cleaned.trim_end());
        let after = match (before.matches(BEGIN).count(), before.matches(END).count()) {
            (0, 0) => format!(
                "{}{}{}{}\n",
                if existed { "" } else { header },
                before,
                if before.is_empty() { "" } else { "\n\n" },
                block
            ),
            (1, 1) => {
                let start = before.find(BEGIN).unwrap();
                let end = before.find(END).unwrap() + END.len();
                if before.find(END).unwrap() < start {
                    return Err("同步标记损坏，请先修复目标文件".into());
                }
                format!("{}{}{}", &before[..start], block, &before[end..])
            }
            _ => return Err("同步标记重复或不完整，原文件保持不变".into()),
        };
        if after.len() > LIMIT as usize {
            return Err("目标文件过大".into());
        }
        let mut sources = Vec::new();
        if ids.is_empty() || ids.len() > 20 {
            return Err("请选择记忆来源".into());
        }
        for id in ids {
            let fingerprint = self.read(id)?.fingerprint;
            if fingerprints.get(id) != Some(&fingerprint) {
                return Err("来源记忆已变化，请重新查看或汇总".into());
            }
            sources.push((id.clone(), fingerprint));
        }
        let id = hash(format!("{}:{}", target.display(), now()).as_bytes());
        let preview = Preview {
            id: id.clone(),
            target: target.to_string_lossy().into_owned(),
            changed: before != after,
            before,
            after,
        };
        if self.plans.len() >= 8 {
            self.plans.clear();
        }
        self.plans.insert(
            id,
            Plan {
                preview: preview.clone(),
                anchor,
                existed,
                sources,
            },
        );
        Ok(preview)
    }
    pub fn apply(&mut self, id: &str, data_dir: &Path) -> Result<SyncResult> {
        let plan = self.plans.remove(id).ok_or("预览已过期，请重新生成")?;
        for (source, fingerprint) in &plan.sources {
            if self.read(source)?.fingerprint != *fingerprint {
                return Err("来源记忆已变化，请刷新并重新预览".into());
            }
        }
        let target = PathBuf::from(&plan.preview.target);
        safe(&plan.anchor, &target)?;
        let current = if target.exists() {
            Some(text(&plan.anchor, &target)?)
        } else {
            None
        };
        if current.is_some() != plan.existed
            || current.as_deref().unwrap_or("") != plan.preview.before
        {
            return Err("目标文件已变化，请重新预览；未写入".into());
        }
        if !plan.preview.changed {
            return Err("目标内容已一致，无需同步".into());
        }
        let backup = if let Some(before) = &current {
            let dir = data_dir.join("memory-backups");
            secure_dir(data_dir)?;
            safe(data_dir, &dir)?;
            secure_dir(&dir)?;
            let file = dir.join(format!("{id}.md"));
            write_new(&file, before.as_bytes(), None)?;
            Some(file.to_string_lossy().into_owned())
        } else {
            None
        };
        atomic_write(
            &plan.anchor,
            &target,
            &plan.preview.after,
            current.as_deref(),
        )?;
        if self.undos.len() >= 8 {
            self.undos.clear();
        }
        self.undos.insert(
            id.into(),
            Undo {
                target: target.clone(),
                anchor: plan.anchor,
                before: current,
                after_hash: hash(plan.preview.after.as_bytes()),
            },
        );
        Ok(SyncResult {
            target: target.to_string_lossy().into_owned(),
            backup,
            undo_id: id.into(),
        })
    }
    pub fn undo(&mut self, id: &str) -> Result<()> {
        let undo = self
            .undos
            .get(id)
            .ok_or("恢复记录不存在；可从备份文件恢复")?;
        let current = text(&undo.anchor, &undo.target)?;
        if hash(current.as_bytes()) != undo.after_hash {
            return Err("同步后文件已被修改，停止恢复以保留新内容".into());
        }
        if let Some(before) = &undo.before {
            atomic_write(&undo.anchor, &undo.target, before, Some(&current))?;
        } else {
            safe(&undo.anchor, &undo.target)?;
            fs::remove_file(&undo.target).map_err(|_| "恢复失败")?;
        }
        self.undos.remove(id);
        Ok(())
    }
}
fn secure_dir(path: &Path) -> Result<()> {
    fs::create_dir_all(path).map_err(|_| "无法创建备份目录")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|_| "无法保护备份目录")?;
    }
    Ok(())
}
fn write_new(path: &Path, bytes: &[u8], permissions: Option<fs::Permissions>) -> Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path).map_err(|_| "无法创建同步文件")?;
    if let Some(p) = permissions {
        file.set_permissions(p).map_err(|_| "无法保留文件权限")?;
    }
    file.write_all(bytes)
        .and_then(|_| file.sync_all())
        .map_err(|_| "无法写入同步文件".to_string())
}
fn atomic_write(anchor: &Path, path: &Path, content: &str, expected: Option<&str>) -> Result<()> {
    safe(anchor, path)?;
    let parent = path.parent().ok_or("目标无效")?;
    fs::create_dir_all(parent).map_err(|_| "无法创建目标目录")?;
    safe(anchor, path)?;
    let temp = parent.join(format!(
        ".tokenlens-sync-{}-{}.tmp",
        std::process::id(),
        now()
    ));
    let permissions = fs::metadata(path).ok().map(|m| m.permissions());
    if permissions.as_ref().is_some_and(fs::Permissions::readonly) {
        return Err("目标文件为只读，未写入".into());
    }
    let result = write_new(&temp, content.as_bytes(), permissions).and_then(|_| {
        safe(anchor, path)?;
        let current = if path.exists() {
            Some(text(anchor, path)?)
        } else {
            None
        };
        if current.as_deref() != expected {
            return Err("目标在同步期间发生变化，已停止写入".into());
        }
        fs::rename(&temp, path).map_err(|_| "无法替换目标文件".into())
    });
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}
