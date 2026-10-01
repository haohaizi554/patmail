import { onMounted, onUnmounted, ref } from 'vue'
import { hydrateMailConcurrency, isMailConcurrencyReady, mailConcurrency, setMailConcurrency, watchMailConcurrency } from './mail-concurrency'

export function useMailConcurrency() {
  const concurrency = ref(mailConcurrency())
  const ready = ref(isMailConcurrencyReady())
  let stop = (): void => {}

  onMounted(() => {
    stop = watchMailConcurrency(() => {
      concurrency.value = mailConcurrency()
      ready.value = isMailConcurrencyReady()
    })
    void hydrateMailConcurrency().then(() => {
      concurrency.value = mailConcurrency()
      ready.value = isMailConcurrencyReady()
    })
  })
  onUnmounted(() => stop())

  async function setConcurrency(next: number): Promise<void> {
    await setMailConcurrency(next)
    concurrency.value = mailConcurrency()
  }

  return { concurrency, ready, setConcurrency }
}
