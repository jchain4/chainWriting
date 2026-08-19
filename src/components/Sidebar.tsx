import type { Doc } from '../lib/storage'

interface SidebarProps {
  docs: Doc[]
  activeDocId: string
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

function formatDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffDays === 0) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  if (diffDays === 1) return 'Ayer'
  if (diffDays < 7) return d.toLocaleDateString('es', { weekday: 'short' })
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short' })
}

export function Sidebar({ docs, activeDocId, onSelect, onCreate, onDelete }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar__header">
        <span className="sidebar__label">Documentos</span>
        <button className="sidebar__new" onClick={onCreate} title="Nuevo documento">
          +
        </button>
      </div>

      <ul className="sidebar__list">
        {docs.length === 0 && (
          <li className="sidebar__empty">Sin documentos</li>
        )}
        {docs.map((doc) => (
          <li
            key={doc.id}
            className={`sidebar__item${doc.id === activeDocId ? ' sidebar__item--active' : ''}`}
            onClick={() => onSelect(doc.id)}
          >
            <span className="sidebar__title">{doc.title}</span>
            <div className="sidebar__meta">
              <span className="sidebar__date">{formatDate(doc.updatedAt)}</span>
              <button
                className="sidebar__delete"
                onClick={(e) => { e.stopPropagation(); onDelete(doc.id) }}
                title="Eliminar documento"
                aria-label="Eliminar"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  )
}
