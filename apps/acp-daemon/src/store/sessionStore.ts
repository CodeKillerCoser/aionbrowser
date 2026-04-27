import { mkdir, readFile, writeFile, appendFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ConversationSummary, SessionEvent } from "@browser-acp/shared-types";
import { SESSIONS_DIR_NAME, SESSIONS_INDEX_FILE_NAME } from "../config/daemonConfig.js";

export class SessionStore {
  private readonly sessionsDir: string;
  private readonly sessionsIndexPath: string;
  private summaryWriteQueue: Promise<void> = Promise.resolve();

  constructor(private readonly rootDir: string) {
    this.sessionsDir = join(rootDir, SESSIONS_DIR_NAME);
    this.sessionsIndexPath = join(rootDir, SESSIONS_INDEX_FILE_NAME);
  }

  async saveSummary(summary: ConversationSummary): Promise<void> {
    this.summaryWriteQueue = this.summaryWriteQueue.then(() => this.saveSummaryNow(summary));
    return this.summaryWriteQueue;
  }

  async listSummaries(): Promise<ConversationSummary[]> {
    await this.summaryWriteQueue;
    return this.readSummaries();
  }

  private async saveSummaryNow(summary: ConversationSummary): Promise<void> {
    await this.ensureStorage();

    const existing = await this.readSummaries();
    const next = existing.filter((entry) => entry.id !== summary.id);
    next.unshift(summary);
    next.sort((left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt));

    await this.writeSummaries(next);
  }

  private async readSummaries(): Promise<ConversationSummary[]> {
    await this.ensureStorage();

    if (!existsSync(this.sessionsIndexPath)) {
      return [];
    }

    const raw = await readFile(this.sessionsIndexPath, "utf8");
    return JSON.parse(raw) as ConversationSummary[];
  }

  private async writeSummaries(summaries: ConversationSummary[]): Promise<void> {
    const tempPath = join(
      dirname(this.sessionsIndexPath),
      `${SESSIONS_INDEX_FILE_NAME}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await writeFile(tempPath, JSON.stringify(summaries, null, 2), "utf8");
    await rename(tempPath, this.sessionsIndexPath);
  }

  async readSummary(sessionId: string): Promise<ConversationSummary | null> {
    const summaries = await this.listSummaries();
    return summaries.find((entry) => entry.id === sessionId) ?? null;
  }

  async appendEvent(sessionId: string, event: SessionEvent): Promise<void> {
    await this.ensureStorage();
    await appendFile(this.getTranscriptPath(sessionId), `${JSON.stringify(event)}\n`, "utf8");
  }

  async readTranscript(sessionId: string): Promise<SessionEvent[]> {
    await this.ensureStorage();

    const transcriptPath = this.getTranscriptPath(sessionId);
    if (!existsSync(transcriptPath)) {
      return [];
    }

    const raw = await readFile(transcriptPath, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as SessionEvent);
  }

  private async ensureStorage(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    await mkdir(this.rootDir, { recursive: true });
  }

  private getTranscriptPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.jsonl`);
  }
}
