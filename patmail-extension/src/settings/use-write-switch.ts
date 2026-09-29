import { onMounted, onUnmounted, ref } from 'vue'
import { hydrateWriteSwitch, isWriteSwitchOpen, setWriteSwitchOpen, watchWriteSwitch } from './write-switch'

export function useWriteSwitch() {
  const open = ref(isWriteSwitchOpen())
  let stop = (): void => {}

  onMounted(() => {
    stop = watchWriteSwitch(() => { open.value = isWriteSwitchOpen() })
    void hydrateWriteSwitch().then(() => { open.value = isWriteSwitchOpen() })
  })
  onUnmounted(() => stop())

  async function setOpen(next: boolean): Promise<void> {
    await setWriteSwitchOpen(next)
    open.value = isWriteSwitchOpen()
  }

  return { open, setOpen }
}
