/** 同一次扫描共享祖先样式结果，避免对每个控件重复计算整条 DOM 链。 */
export function createVisibilityDetector(): (element: Element) => boolean {
  const visibleStyles = new WeakMap<Element, boolean>()

  function ancestorsVisible(element: Element): boolean {
    const cached = visibleStyles.get(element)
    if (cached !== undefined) return cached
    const parent = element.parentElement
    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    const visible = !element.hasAttribute('hidden') &&
      style?.display !== 'none' && style?.visibility !== 'hidden' &&
      style?.visibility !== 'collapse' && style?.opacity !== '0' &&
      style?.contentVisibility !== 'hidden' &&
      (parent === null || ancestorsVisible(parent))
    visibleStyles.set(element, visible)
    return visible
  }

  return (element: Element): boolean => {
    if (!element.isConnected || !ancestorsVisible(element)) return false
    // 固定定位控件的 offsetParent 可以为 null，依据实际绘制矩形判断。
    return Array.from(element.getClientRects()).some(rect => rect.width > 0 && rect.height > 0)
  }
}
