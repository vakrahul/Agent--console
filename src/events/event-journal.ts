import type { JournalEntry, ServerMessage } from "@/protocol/types";

export class EventJournal {
  private entries: JournalEntry[] = [];
  private seqIndex = new Set<number>();

  append(event: ServerMessage, replayed = false): JournalEntry | null {
    if (this.seqIndex.has(event.seq)) return null;
    const entry: JournalEntry = {
      seq: event.seq,
      type: event.type,
      timestamp: Date.now(),
      event,
      replayed
    };
    this.entries.push(entry);
    this.seqIndex.add(event.seq);
    return entry;
  }

  all(): JournalEntry[] {
    return this.entries;
  }

  reset(): void {
    this.entries = [];
    this.seqIndex.clear();
  }

  compactTokens(maxTokenEntries: number): void {
    const tokens = this.entries.filter((entry) => entry.type === "TOKEN");
    if (tokens.length <= maxTokenEntries) return;
    const tokenSeqsToDrop = new Set(tokens.slice(0, tokens.length - maxTokenEntries).map((entry) => entry.seq));
    this.entries = this.entries.filter((entry) => !tokenSeqsToDrop.has(entry.seq));
    for (const seq of tokenSeqsToDrop) this.seqIndex.delete(seq);
  }
}
