import { onMounted, onUnmounted, ref } from 'vue'
import { defaultWorkflowCatalog, type WorkflowCatalog } from '../../workflow/catalog'
import { loadWorkflowCatalog, watchWorkflowCatalog } from '../../workflow/catalog-store'

export function useWorkflowCatalog() {
  const catalog = ref<WorkflowCatalog>(defaultWorkflowCatalog())
  let stop = (): void => {}

  onMounted(() => {
    void loadWorkflowCatalog().then(next => {
      catalog.value = next
    })
    stop = watchWorkflowCatalog(next => {
      catalog.value = next
    })
  })

  onUnmounted(() => stop())
  return { catalog }
}
