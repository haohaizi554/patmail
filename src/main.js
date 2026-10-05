import { createApp } from 'vue'
import { hintDirective } from './components/hint'
import App from './App.vue'
import './style.css'

const app = createApp(App)
app.directive('hint', hintDirective)
app.mount('#app')
