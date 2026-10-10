export type NamedTotal = {
  name: string;
  totalTokens: number;
  freshInput: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
};
export type RequestLog = {
  timestampMs: number;
  app: string;
  provider: string;
  model: string;
  freshInput: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
};
export type SeriesPoint = { bucket: string; model: string; totalTokens: number; eventCount: number };
export type Overview = {
  range: string;
  rangeStartMs: number;
  rangeEndMs: number;
  undatedCount: number;
  totalTokens: number;
  freshInput: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  reasoningTokens: number;
  eventCount: number;
  byModel: NamedTotal[];
  byApp: NamedTotal[];
  byProject: NamedTotal[];
  byProvider: NamedTotal[];
  series: SeriesPoint[];
  bucketKind: string;
  requests: RequestLog[];
  providers: string[];
  models: string[];
};
export type DayTotal = {
  day: string;
  totalTokens: number;
  eventCount: number;
  freshInput: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};
export type SourceReport = { app: string; events: number; detail: string; coverage: string };

export type Project = { root: string; name: string; guidance: boolean };
export type HandoffEvent = { id: number; ts: string; tool: string; summary: string; done: string[]; next: string[] };
export type Decision = {
  id: number;
  ts: string;
  tool: string;
  title: string;
  rationale: string;
  status: string;
  supersededBy: number | null;
};
export type ProjectMemory = {
  events: HandoffEvent[];
  decisions: Decision[];
  eventCount: number;
  decisionCount: number;
  brief: string;
};

export type Range = "today" | "7d" | "30d" | "all";
export type PageId = "home" | "usage" | "tools" | "handoffs" | "memory" | "settings";
