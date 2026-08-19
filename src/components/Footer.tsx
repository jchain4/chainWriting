interface FooterProps {
  wordCount: number
  docTitle: string
  docHtml: string
  typewriterMode: boolean
  focusMode: boolean
  onToggleTypewriter: () => void
  onToggleFocus: () => void
  onExport: () => void
}

export function Footer({
  wordCount,
  typewriterMode,
  focusMode,
  onToggleTypewriter,
  onToggleFocus,
  onExport,
}: FooterProps) {
  const readingMin = Math.max(1, Math.round(wordCount / 200))
  const label = wordCount === 1 ? 'palabra' : 'palabras'

  return (
    <footer className={`footer${focusMode ? ' footer--hidden' : ''}`}>
      <span className="footer__count">
        {wordCount} {label} · {readingMin} min
      </span>

      <div className="footer__actions">
        <button
          className={`footer__btn${typewriterMode ? ' footer__btn--active' : ''}`}
          onClick={onToggleTypewriter}
          title="Modo máquina de escribir (Ctrl+T)"
        >
          ¶
        </button>
        <button
          className={`footer__btn${focusMode ? ' footer__btn--active' : ''}`}
          onClick={onToggleFocus}
          title="Modo foco (Ctrl+Shift+F)"
        >
          ⊡
        </button>
        <button className="footer__btn footer__export" onClick={onExport} title="Exportar a Markdown">
          .md
        </button>
      </div>
    </footer>
  )
}
