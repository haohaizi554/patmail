import { nextTick, onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

const GAP = 8

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

/** Position is measured from the viewport's top and right edges. */
export function usePanelDrag(panel: Ref<HTMLElement | null>, collapsed: Ref<boolean>) {
  const position = ref({ top: 80, right: 16 })
  const dragging = ref(false)
  let drag: { pointerId: number; bar: HTMLElement; offsetX: number; offsetY: number } | null = null

  function place(left: number, top: number): void {
    const rect = panel.value?.getBoundingClientRect()
    if (!rect) return
    const maxLeft = Math.max(GAP, window.innerWidth - rect.width - GAP)
    const maxTop = Math.max(GAP, window.innerHeight - rect.height - GAP)
    const clampedLeft = clamp(left, GAP, maxLeft)
    position.value = {
      top: clamp(top, GAP, maxTop),
      right: Math.max(0, window.innerWidth - clampedLeft - rect.width)
    }
  }

  function keepVisible(): void {
    const rect = panel.value?.getBoundingClientRect()
    if (rect) place(rect.left, rect.top)
  }

  function finishDrag(): void {
    if (!drag) return
    const { bar, pointerId } = drag
    bar.removeEventListener('pointermove', onPointerMove)
    bar.removeEventListener('pointerup', onPointerEnd)
    bar.removeEventListener('pointercancel', onPointerEnd)
    bar.removeEventListener('lostpointercapture', onPointerEnd)
    if (bar.hasPointerCapture(pointerId)) bar.releasePointerCapture(pointerId)
    drag = null
    dragging.value = false
  }

  function onPointerMove(event: PointerEvent): void {
    if (!drag || event.pointerId !== drag.pointerId) return
    place(event.clientX - drag.offsetX, event.clientY - drag.offsetY)
  }

  function onPointerEnd(event: PointerEvent): void {
    if (drag && event.pointerId === drag.pointerId) finishDrag()
  }

  function onPointerDown(event: PointerEvent): void {
    if (!event.isPrimary || event.button !== 0 || drag) return
    const target = event.target
    if (target instanceof Element && target.closest('button')) return
    const bar = event.currentTarget
    const rect = panel.value?.getBoundingClientRect()
    if (!(bar instanceof HTMLElement) || !rect) return
    drag = {
      pointerId: event.pointerId,
      bar,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    }
    dragging.value = true
    bar.addEventListener('pointermove', onPointerMove)
    bar.addEventListener('pointerup', onPointerEnd)
    bar.addEventListener('pointercancel', onPointerEnd)
    bar.addEventListener('lostpointercapture', onPointerEnd)
    bar.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  onMounted(() => {
    keepVisible()
    window.addEventListener('resize', keepVisible)
  })
  watch(collapsed, async () => {
    await nextTick()
    keepVisible()
  })
  onBeforeUnmount(() => {
    finishDrag()
    window.removeEventListener('resize', keepVisible)
  })

  return { position, dragging, onPointerDown }
}
