/** Snapshot based undo/redo stack. Snapshots are serialized object lists. */
export class CanvasHistory {
  private stack: string[] = []
  private index = -1

  constructor(private readonly limit = 100) {}

  reset(snapshot: string): void {
    this.stack = [snapshot]
    this.index = 0
  }

  /** Records a new state. Returns false if nothing changed. */
  push(snapshot: string): boolean {
    if (snapshot === this.stack[this.index]) return false
    this.stack = this.stack.slice(0, this.index + 1)
    this.stack.push(snapshot)
    if (this.stack.length > this.limit) this.stack.shift()
    this.index = this.stack.length - 1
    return true
  }

  undo(): string | null {
    return this.canUndo ? this.stack[--this.index] : null
  }

  redo(): string | null {
    return this.canRedo ? this.stack[++this.index] : null
  }

  get current(): string | undefined {
    return this.stack[this.index]
  }

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index < this.stack.length - 1
  }
}
