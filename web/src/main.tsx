import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './tokens.css'
import './styles.css'
import './table-controls.css'
import './editor.css'
import './form-controls.css'
import './feedback-typography.css'
import './redesign.css'
import './workspace.css'
import './editor-studio.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
