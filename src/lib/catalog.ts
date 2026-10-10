export type ToolKind = "CLI" | "IDE" | "桌面";
export type Tool = {
  id: string;
  name: string;
  kind: ToolKind;
  about: string;
  /** Short monogram shown in the colored tile. */
  glyph: string;
  color: string;
  /** Can be wired to project memory over MCP / guidance files. */
  memory: boolean;
};

/** Single source of truth for every tool TokenLens knows about. */
export const TOOLS: Tool[] = [
  { id: "claude-code", name: "Claude Code", kind: "CLI", about: "终端编码与项目探索", glyph: "Cc", color: "#d97757", memory: true },
  { id: "codex", name: "Codex", kind: "CLI", about: "编码任务与项目协作", glyph: "Cx", color: "#10a37f", memory: true },
  { id: "zcode", name: "ZCode", kind: "CLI", about: "终端开发与多模型协作", glyph: "Z", color: "#3a8fd9", memory: true },
  { id: "gemini-cli", name: "Gemini CLI", kind: "CLI", about: "终端编码与上下文处理", glyph: "Ge", color: "#5b7be0", memory: true },
  { id: "opencode", name: "OpenCode", kind: "CLI", about: "开源终端编码工具", glyph: "Oc", color: "#6b7585", memory: true },
  { id: "cursor", name: "Cursor", kind: "IDE", about: "编辑器内的 AI 开发", glyph: "Cu", color: "#7a8494", memory: true },
  { id: "kiro", name: "Kiro", kind: "IDE", about: "规范与任务驱动开发", glyph: "Ki", color: "#8b5cf6", memory: true },
  { id: "windsurf", name: "Windsurf", kind: "IDE", about: "编辑器与编码助手", glyph: "Ws", color: "#0ea5a4", memory: true },
  { id: "trae", name: "Trae", kind: "IDE", about: "AI 开发环境", glyph: "Tr", color: "#e0642b", memory: true },
  { id: "antigravity", name: "Antigravity", kind: "IDE", about: "Agent 开发工作台", glyph: "Ag", color: "#ec6a8a", memory: true },
  { id: "vscode-copilot", name: "VS Code Copilot", kind: "IDE", about: "编辑器内的编码助手", glyph: "Co", color: "#2f6fdd", memory: true },
  { id: "codemate", name: "CodeMate", kind: "IDE", about: "自研编码工作流", glyph: "Cm", color: "#14b8a6", memory: true },
  { id: "claude-desktop", name: "Claude Desktop", kind: "桌面", about: "桌面对话与工具调用", glyph: "Cd", color: "#c46a4a", memory: true },
  { id: "chatgpt", name: "ChatGPT", kind: "桌面", about: "对话与项目辅助", glyph: "Gp", color: "#10a37f", memory: false },
];

const byKey = new Map<string, Tool>();
for (const t of TOOLS) {
  byKey.set(t.id, t);
  byKey.set(t.name, t);
}
/** Usage rows carry display names ("Claude Code"); sources carry ids ("claude-code"). */
export const findTool = (idOrName: string) => byKey.get(idOrName);
export const toolName = (idOrName: string) => byKey.get(idOrName)?.name ?? idOrName;
export const toolId = (idOrName: string) => byKey.get(idOrName)?.id ?? idOrName;

export const COVERAGE: Record<string, string> = {
  counted: "已采集",
  partial: "部分采集",
  missing: "未发现记录",
  unavailable: "暂无法采集",
  error: "读取失败",
};

/** Colors for stacked charts: model order is stable, so colors stay consistent between views. */
export const CHART_COLORS = ["#4566dd", "#2fa89a", "#e0914a", "#a35fd0", "#d2557a", "#6bb04a", "#3d9bd6"];
export const OTHER_COLOR = "#9aa3b2";
