/** Serializes saves and always drains the latest draft, including deletions. */
export class ExamDrafts {
  private drafts = new Map<string, string>();
  private confirmed = new Map<string, string>();
  private running: Promise<void> | null = null;

  constructor(private write: (id: string, value: string) => Promise<unknown>) {}

  set(id: string, value: string) {
    this.drafts.set(id, value);
  }

  pending(): [string, string][] {
    return [...this.drafts].filter(([id, value]) => this.confirmed.get(id) !== value);
  }

  flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.drain().finally(() => { this.running = null; });
    return this.running;
  }

  private async drain() {
    for (let next = this.pending()[0]; next; next = this.pending()[0]) {
      const [id, value] = next;
      await this.write(id, value);
      this.confirmed.set(id, value);
    }
  }
}
