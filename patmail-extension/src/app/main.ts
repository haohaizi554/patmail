import { createApp } from 'vue'
import { hintDirective } from '../shell/components/hint'
import App from './App.vue'
import '../floating/style.css'
import './styles/workspace.css'
import '../shell/style.css'

const app = createApp(App)
app.directive('hint', hintDirective)
app.mount('#app')
