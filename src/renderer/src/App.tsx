import { useCallback, useEffect, useState } from 'react'
import type { SiteView } from '../../core/types'
import { api, friendlyError, type FriendlyError } from './api'
import { Sidebar } from './components/Sidebar'
import { SiteDetail } from './components/SiteDetail'
import { SiteForm } from './components/SiteForm'
import { SetupWizard } from './components/SetupWizard'
import { EmptyState } from './components/EmptyState'
import { DropOverlay } from './components/DropOverlay'
import { Toast } from './components/Toast'
import { AppSettingsDialog } from './components/AppSettingsDialog'
import { AgentSettingsDialog } from './components/AgentSettingsDialog'

export function App() {
  const [sites, setSites] = useState<SiteView[] | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<{ kind: 'create'; localPath?: string } | { kind: 'edit'; site: SiteView } | null>(null)
  const [error, setError] = useState<FriendlyError | null>(null)
  const [dragging, setDragging] = useState(false)
  const [rescanToken, setRescanToken] = useState(0)
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)

  // Keep the main process informed about the selected site (menu bar count), and react to it.
  useEffect(() => {
    api.app.setSelectedSite(selectedId)
  }, [selectedId])
  useEffect(() => {
    const offs = [
      api.app.onSelectSite((id) => {
        setSelectedId(id)
        void reload(id)
      }),
      api.app.onOpenAppSettings(() => setAppSettingsOpen(true)),
      api.app.onChangesUpdated(() => {
        api.sites.list().then(setSites, () => undefined)
      }),
      api.serverCheck.onUpdated(() => {
        api.sites.list().then(setSites, () => undefined)
      })
    ]
    return () => offs.forEach((off) => off())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Look for changes again whenever the window comes back into focus.
  useEffect(() => {
    const onFocus = () => setRescanToken((t) => t + 1)
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [])

  const reload = useCallback(async (selectId?: string) => {
    try {
      const list = await api.sites.list()
      setSites(list)
      setSelectedId((cur) => {
        const want = selectId ?? cur
        if (want && list.some((s) => s.id === want)) return want
        return list[0]?.id ?? null
      })
    } catch (err) {
      setError(friendlyError(err))
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Refresh counts in the sidebar after a scan, without touching the selection.
  const reloadQuiet = useCallback(() => {
    api.sites.list().then(setSites, () => undefined)
  }, [])

  const startNewSite = useCallback((localPath?: string) => {
    setForm({ kind: 'create', localPath })
  }, [])

  const chooseFolderAndStart = useCallback(async () => {
    const folder = await api.files.chooseFolder()
    if (folder) startNewSite(folder)
  }, [startNewSite])

  // Drag a folder anywhere in the window to add it as a site.
  useEffect(() => {
    let depth = 0
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth++
      setDragging(true)
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onOver = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault()
    }
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      depth = 0
      setDragging(false)
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      const path = api.files.pathForFile(file)
      if (path && (await api.files.isFolder(path))) {
        const existing = sites?.find((s) => s.localPath === path)
        if (existing) setSelectedId(existing.id)
        else startNewSite(path)
      } else {
        setError({ message: 'Det du dro inn er ikke en mappe.', hint: 'Dra inn hele mappen som inneholder nettsiden.' })
      }
    }
    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('dragover', onOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [sites, startNewSite])

  const selected = sites?.find((s) => s.id === selectedId) ?? null

  return (
    <div className="app">
      <Sidebar sites={sites ?? []} selectedId={selectedId} onSelect={setSelectedId} onAdd={chooseFolderAndStart} onAppSettings={() => setAppSettingsOpen(true)} />
      <main className="content">
        <div className="titlebar-drag" />
        {sites === null ? null : selected ? (
          <SiteDetail
            key={selected.id}
            site={selected}
            onEdit={() => setForm({ kind: 'edit', site: selected })}
            onError={setError}
            rescanToken={rescanToken}
            onScanned={reloadQuiet}
          />
        ) : (
          <EmptyState onChooseFolder={chooseFolderAndStart} />
        )}
      </main>

      {form?.kind === 'create' && (
        <SetupWizard
          initialPath={form.localPath}
          onClose={() => setForm(null)}
          onSaved={(site) => {
            setForm(null)
            void reload(site.id)
          }}
        />
      )}
      {form?.kind === 'edit' && (
        <SiteForm
          site={form.site}
          onRemoved={() => {
            setForm(null)
            void reload()
          }}
          onClose={() => setForm(null)}
          onSaved={(site) => {
            setForm(null)
            void reload(site.id)
            setRescanToken((t) => t + 1)
          }}
        />
      )}
      {appSettingsOpen && (
        <AppSettingsDialog
          onOpenAgent={() => {
            setAppSettingsOpen(false)
            setAgentOpen(true)
          }}
          onClose={() => {
            setAppSettingsOpen(false)
            setRescanToken((t) => t + 1)
            void reload()
          }}
        />
      )}
      {agentOpen && <AgentSettingsDialog onClose={() => setAgentOpen(false)} />}
      {dragging && <DropOverlay />}
      {error && <Toast error={error} onClose={() => setError(null)} />}
    </div>
  )
}
