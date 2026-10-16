import type { ReactNode } from 'react'
import type { CloudState, Project, Scope, Stats } from '../../../shared/types'
import { Icon } from './Icon'

export type Page = 'entries' | 'todos' | 'settings'

interface Props {
  projects: Project[]
  stats: Stats | null
  cloud: CloudState | null
  canLock: boolean
  scope: Scope
  page: Page
  onPage: (p: Page) => void
  onScope: (s: Scope) => void
  onNewProject: () => void
  onEditProject: (p: Project) => void
  onDeleteProject: (p: Project) => void
}

export function Sidebar(props: Props) {
  const { projects, stats, cloud, scope, page, onScope } = props
  const isEntries = page === 'entries'

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="logo">
          <Icon name="key" size={18} />
        </div>
        <div>
          <div className="brand-name">DevVault</div>
          <div className="brand-sub">开发账号 & 待办助手</div>
        </div>
      </div>

      <nav className="nav pages">
        <NavItem
          active={page === 'entries'}
          onClick={() => props.onPage('entries')}
          icon={<Icon name="key" />}
          label="账号密码"
          count={stats?.entries}
        />
        <NavItem
          active={page === 'todos'}
          onClick={() => props.onPage('todos')}
          icon={<Icon name="check" />}
          label="待办事项"
          count={stats?.todos}
          badge
        />
      </nav>

      <div className="nav-section">
        <span>项目</span>
        <button className="icon-btn sm" title="新建项目" onClick={props.onNewProject}>
          <Icon name="plus" size={14} />
        </button>
      </div>

      <nav className="nav">
        <NavItem
          active={scope === 'all'}
          onClick={() => onScope('all')}
          icon={<Icon name="layers" />}
          label="全部项目"
          count={isEntries ? stats?.entries : stats?.todos}
        />
        <NavItem
          active={scope === 'none'}
          onClick={() => onScope('none')}
          icon={<Icon name="inbox" />}
          label="未分组"
          count={isEntries ? stats?.noneEntries : stats?.noneTodos}
        />
      </nav>

      <nav className="nav projects">
        {projects.length === 0 && (
          <button className="nav-empty" onClick={props.onNewProject}>
            + 创建第一个项目
          </button>
        )}
        {projects.map((p) => (
          <NavItem
            key={p.id}
            active={scope === p.id}
            onClick={() => onScope(p.id)}
            icon={<span className="dot" style={{ background: p.color }} />}
            label={p.name}
            title={p.description || p.name}
            count={isEntries ? p.entry_count : p.todo_count}
            actions={
              <>
                <button
                  className="icon-btn xs"
                  title="编辑项目"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onEditProject(p)
                  }}
                >
                  <Icon name="edit" size={12} />
                </button>
                <button
                  className="icon-btn xs danger"
                  title="删除项目"
                  onClick={(e) => {
                    e.stopPropagation()
                    props.onDeleteProject(p)
                  }}
                >
                  <Icon name="trash" size={12} />
                </button>
              </>
            }
          />
        ))}
      </nav>

      <div className="sidebar-foot">
        <button
          className={`account-chip ${page === 'settings' ? 'active' : ''}`}
          onClick={() => props.onPage('settings')}
          title="账号与设置"
        >
          {cloud?.loggedIn && cloud.user ? (
            <span className="avatar">{cloud.user.name.slice(0, 1).toUpperCase()}</span>
          ) : (
            <span className="avatar off">
              <Icon name="cloud" size={14} />
            </span>
          )}
          <span className="account-text">
            <b>{cloud?.loggedIn && cloud.user ? cloud.user.name : '本地模式'}</b>
            <small>{cloud?.loggedIn ? '已登录' : '未登录 · 点击登录'}</small>
          </span>
        </button>
        {props.canLock && (
          <button className="icon-btn" title="立即锁定 (Ctrl + L)" onClick={() => window.api.lockNow()}>
            <Icon name="lock" size={15} />
          </button>
        )}
        <button
          className={`icon-btn ${page === 'settings' ? 'on' : ''}`}
          title="设置"
          onClick={() => props.onPage('settings')}
        >
          <Icon name="gear" size={15} />
        </button>
      </div>
    </aside>
  )
}

function NavItem(props: {
  active: boolean
  onClick: () => void
  icon: ReactNode
  label: string
  title?: string
  count?: number
  badge?: boolean
  actions?: ReactNode
}) {
  return (
    <div className={`nav-item ${props.active ? 'active' : ''}`} onClick={props.onClick} title={props.title}>
      <span className="nav-icon">{props.icon}</span>
      <span className="nav-label">{props.label}</span>
      {props.actions && <span className="nav-actions">{props.actions}</span>}
      {props.count !== undefined && props.count > 0 && <span className={`nav-count ${props.badge ? 'badge' : ''}`}>{props.count}</span>}
    </div>
  )
}
