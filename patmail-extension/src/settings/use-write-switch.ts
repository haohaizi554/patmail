import { onMounted, onUnmounted, ref } from 'vue'
import { hydrateWriteSwitch, isWriteSwitchOpen, isWriteSwitchReady, setWriteSwitchOpen, watchWriteSwitch } from './write-switch'

export function useWriteSwitch() {
  const open = ref(isWriteSwitchOpen())
  const ready = ref(isWriteSwitchReady())
  let stop = (): void => {}

  onMounted(() => {
    stop = watchWriteSwitch(() => {
      open.value = isWriteSwitchOpen()
      ready.value = isWriteSwitchReady()
    })
    void hydrateWriteSwitch().then(() => {
      open.value = isWriteSwitchOpen()
      ready.value = isWriteSwitchReady()
    })
  })
  onUnmounted(() => stop())

  async function setOpen(next: boolean): Promise<void> {
    await setWriteSwitchOpen(next)
    open.value = isWriteSwitchOpen()
  }

  return { open, ready, setOpen }
}
