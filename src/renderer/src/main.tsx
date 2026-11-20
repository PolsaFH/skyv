import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { TrayApp } from './TrayApp'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.hash === '#tray' ? <TrayApp /> : <App />}
  </StrictMode>
)
