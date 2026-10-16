import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AppInfo,
  AppPrefs,
  CloudState,
  LockState,
  PriorityLevel,
  Project,
  ProjectInput,
  Scope,
  Stats,
  TodoStatus
} from '../../shared/types'
import { PROJECT_COLORS } from './constants'
import { EntriesView } from './components/EntriesView'
import { Icon } from './components/Icon'
import { ProjectModal } from './components/ProjectModal'
import { SettingsView } from './components/SettingsView'
import { Sidebar, type Page } from './components/Sidebar'
import { TodosPage } from './components/todos/TodosPage'
import { ConfirmHost, Toaster, confirmDialog, errText, toast } from './components/ui'

const PAGE_TITLES: Record<Page, string> = { entries: '账号密码', todos: '待办事项', settings: '设置' }

export default function App({ lock }: { lock: LockState }) {
  const [projects, setProjects] = useState<Project[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [levels, setLevels] = useState<PriorityLevel[]>([])
  const [statuses, setStatuses] = useState<TodoStatus[]>([])
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [cloud, setCloud] = useState<CloudState | null>(null)
  const [prefs, setPrefs] = useState<AppPrefs | null>(null)
  // 通知 / 托盘跳转请求：n 递增使目标视图响应同一目标的重复跳转
  const [todoFocus, setTodoFocus] = useState<{ todoId: number; n: number }>()
  const [entryNav, setEntryNav] = useState<{ filter: 'expiring'; n: number }>()
  const [scope, setScope] = useState<Scope>('all')
  const [page, setPage] = useState<Page>('entries')
  const [keyword, setKeyword] = useState('')
  const [version, setVersion] = useState(0)
  const [projectForm, setProjectForm] = useState<ProjectInput | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const refresh = useCallback(() => setVersion((v) => v + 1), [])

  useEffect(() => {
    window.api.appInfo().then(setInfo)
    window.api.cloudState().then(setCloud)
    window.api.getPrefs().then(setPrefs)
    const offCloud = window.api.onCloudChanged(setCloud)
    const offPrefs = window.api.onPrefsChanged(setPrefs)
    // 桌面任务条上的操作也会触发刷新
    const offChanged = window.api.onTodosChanged(refresh)
    let seq = 0
    const offNav = window.api.onNavigate((t) => {
      setPage(t.page)
      if (t.todoId) setTodoFocus({ todoId: t.todoId, n: ++seq })
      if (t.entryFilter) {
        setScope('all')
        setEntryNav({ filter: t.entryFilter, n: ++seq })
      }
    })
    return () => {
      offChanged()
      offNav()
      offCloud()
      offPrefs()
    }
  }, [refresh])

  useEffect(() => {
    Promise.all([
      window.api.listProjects(),
      window.api.getStats(),
      window.api.listPriorities(),
      window.api.listStatuses()
    ]).then(([p, s, l, st]) => {
      setProjects(p)
      setStats(s)
      setLevels(l)
      setStatuses(st)
      setScope((cur) => (typeof cur === 'number' && !p.some((x) => x.id === cur) ? 'all' : cur))
    })
  }, [version])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const current = typeof scope === 'number' ? projects.find((p) => p.id === scope) : undefined
  const scopeTitle = scope === 'all' ? '全部项目' : scope === 'none' ? '未分组' : (current?.name ?? '')

  const deleteProject = async (p: Project) => {
    const ok = await confirmDialog(
      `删除项目「${p.name}」后，其下的账号记录和待办不会被删除，会移入「未分组」。`,
      { title: '删除项目', okText: '删除项目' }
    )
    if (!ok) return
    await window.api.deleteProject(p.id)
    toast('项目已删除')
    refresh()
  }

  const exportData = async () => {
    const ok = await confirmDialog('导出文件中的密码为明文，请妥善保管备份文件，勿上传至公共仓库或群聊。', {
      title: '导出备份',
      okText: '继续导出',
      danger: false
    })
    if (!ok) return
    try {
      const path = await window.api.exportData()
      if (path) toast(`已导出到 ${path}`)
    } catch (e) {
      toast(errText(e), 'err')
    }
  }

  const importData = async () => {
    try {
      const r = await window.api.importData()
      if (!r) return
      toast(`导入完成：新增项目 ${r.projects} 个，记录 ${r.entries} 条，待办 ${r.todos} 条`)
      refresh()
    } catch (e) {
      toast(`导入失败：${errText(e)}`, 'err')
    }
  }

  return (
    <div className="app">
      <Sidebar
        projects={projects}
        stats={stats}
        cloud={cloud}
        canLock={lock.hasPassword}
        scope={scope}
        page={page}
        onPage={setPage}
        onScope={(s) => {
          setScope(s)
          if (page === 'settings') setPage('entries')
        }}
        onNewProject={() =>
          setProjectForm({ name: '', color: PROJECT_COLORS[projects.length % PROJECT_COLORS.length], description: '' })
        }
        onEditProject={(p) => setProjectForm({ id: p.id, name: p.name, color: p.color, description: p.description })}
        onDeleteProject={deleteProject}
      />

      <main className="main">
        <header className="topbar">
          <div className="scope">
            <div className="scope-text">
              <h1>{PAGE_TITLES[page]}</h1>
              {page === 'settings' ? (
                <p>账号、安全与数据</p>
              ) : (
                <p title={current?.description || undefined}>
                  {current && <span className="dot" style={{ background: current.color }} />}
                  {scopeTitle}
                  {current?.description && <span className="scope-desc"> · {current.description}</span>}
                </p>
              )}
            </div>
          </div>

          <div className="search" hidden={page === 'settings'}>
            <Icon name="search" size={15} />
            <input
              ref={searchRef}
              value={keyword}
              placeholder={page === 'entries' ? '搜索名称、账号、地址、备注、标签…' : '搜索待办…'}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setKeyword('')}
            />
            {keyword ? (
              <button className="icon-btn xs" onClick={() => setKeyword('')} title="清空">
                <Icon name="x" size={12} />
              </button>
            ) : (
              <kbd>Ctrl F</kbd>
            )}
          </div>
        </header>

        {page === 'settings' ? (
          <SettingsView info={info} lock={lock} cloud={cloud} prefs={prefs} onExport={exportData} onImport={importData} />
        ) : page === 'entries' ? (
          <EntriesView
            scope={scope}
            keyword={keyword}
            projects={projects}
            version={version}
            expiryDays={prefs?.expiryDays ?? 7}
            nav={entryNav}
            onChanged={refresh}
          />
        ) : (
          <TodosPage
            scope={scope}
            keyword={keyword}
            projects={projects}
            levels={levels}
            statuses={statuses}
            version={version}
            focus={todoFocus}
            onChanged={refresh}
          />
        )}
      </main>

      {projectForm && (
        <ProjectModal
          initial={projectForm}
          onClose={() => setProjectForm(null)}
          onSaved={(id) => {
            const isNew = !projectForm.id
            setProjectForm(null)
            if (isNew) setScope(id)
            refresh()
          }}
        />
      )}
      <Toaster />
      <ConfirmHost />
    </div>
  )
}
