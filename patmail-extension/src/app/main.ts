import { createApp } from 'vue'
import { hintDirective } from '../shell/components/hint'
import { bindFileManageRecovery } from '../customer/file-manage-submit'
import { bindLimitMailRecovery } from '../customer/limit-mail-submit'
import { recallRecovery, rememberRecovery } from '../recovery/wal-ledger'
import App from './App.vue'
import '../floating/style.css'
import './styles/workspace.css'
import '../shell/style.css'

bindLimitMailRecovery({
  load: () => recallRecovery('limit-mail', 'local'),
  save: marks => { void rememberRecovery('limit-mail', 'local', marks) }
})
bindFileManageRecovery({
  load: () => recallRecovery('file-mail', 'local'),
  save: marks => { void rememberRecovery('file-mail', 'local', marks) }
})

const app = createApp(App)
app.directive('hint', hintDirective)
app.mount('#app')
