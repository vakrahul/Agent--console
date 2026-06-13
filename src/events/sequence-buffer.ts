import type { ServerMessage } from "@/protocol/types";

export type SequenceMetrics = {
  lastReceivedSeq: number;
  lastProcessedSeq: number;
  duplicateCount: number;
  bufferedCount: number;
};

export type SequenceDrainResult = {
  processable: ServerMessage[];
  duplicates: ServerMessage[];
  buffered: ServerMessage[];
  metrics: SequenceMetrics;
};

export class SequenceBuffer {
  private pendingEvents = new Map<number, ServerMessage>();
  private processedEvents = new Set<number>();
  private expectedSequence: number;
  private lastReceivedSeq = 0;
  private lastProcessedSeq = 0;
  private duplicateCount = 0;

  constructor(startSequence = 1) {
    this.expectedSequence = startSequence;
  }

  getMetrics(): SequenceMetrics {
    return {
      lastReceivedSeq: this.lastReceivedSeq,
      lastProcessedSeq: this.lastProcessedSeq,
      duplicateCount: this.duplicateCount,
      bufferedCount: this.pendingEvents.size
    };
  }

  accept(event: ServerMessage): SequenceDrainResult {
    const duplicates: ServerMessage[] = [];
    const buffered: ServerMessage[] = [];
    const processable: ServerMessage[] = [];
    this.lastReceivedSeq = Math.max(this.lastReceivedSeq, event.seq);

    if (this.processedEvents.has(event.seq) || this.pendingEvents.has(event.seq)) {
      this.duplicateCount += 1;
      duplicates.push(event);
      return { processable, duplicates, buffered, metrics: this.getMetrics() };
    }

    if (event.seq > this.expectedSequence) {
      this.pendingEvents.set(event.seq, event);
      buffered.push(event);
      return { processable, duplicates, buffered, metrics: this.getMetrics() };
    }

    if (event.seq < this.expectedSequence) {
      this.duplicateCount += 1;
      duplicates.push(event);
      return { processable, duplicates, buffered, metrics: this.getMetrics() };
    }

    processable.push(event);
    this.markProcessed(event.seq);
    this.drainPending(processable);

    return { processable, duplicates, buffered, metrics: this.getMetrics() };
  }

  resetAfterResume(lastProcessedSeq: number): void {
    this.expectedSequence = lastProcessedSeq + 1;
    this.lastProcessedSeq = lastProcessedSeq;
    for (const seq of [...this.pendingEvents.keys()]) {
      if (seq <= lastProcessedSeq) this.pendingEvents.delete(seq);
    }
  }

  resetForNewTurn(): void {
    this.pendingEvents.clear();
    this.processedEvents.clear();
    this.expectedSequence = 1;
    this.lastReceivedSeq = 0;
    this.lastProcessedSeq = 0;
    this.duplicateCount = 0;
  }

  private drainPending(processable: ServerMessage[]): void {
    while (this.pendingEvents.has(this.expectedSequence)) {
      const next = this.pendingEvents.get(this.expectedSequence);
      if (!next) return;
      this.pendingEvents.delete(this.expectedSequence);
      processable.push(next);
      this.markProcessed(next.seq);
    }
  }

  private markProcessed(seq: number): void {
    this.processedEvents.add(seq);
    this.lastProcessedSeq = seq;
    this.expectedSequence = seq + 1;
  }
}
