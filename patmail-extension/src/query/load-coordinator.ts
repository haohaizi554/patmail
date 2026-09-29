/** 让后发起的模板加载作废先发起的结果，组件卸载后不再提交状态。 */
export class TemplateLoadCoordinator {
  private serial = 0
  private disposed = false
  private controller: AbortController | null = null

  begin(): { id: number; signal: AbortSignal } {
    this.controller?.abort()
    this.serial += 1
    this.controller = new AbortController()
    return { id: this.serial, signal: this.controller.signal }
  }

  isCurrent(id: number): boolean {
    return !this.disposed && id === this.serial
  }

  peek(): number {
    return this.serial
  }

  dispose(): void {
    this.disposed = true
    this.serial += 1
    this.controller?.abort()
    this.controller = null
  }
}
