import { GlassMenu } from './GlassMenu'

export type SeasonOption = {
  number: number
  episodes: number
  done: boolean // vista completa
}

// Selector de temporada: el menú desplegable de vidrio (GlassMenu) con
// "Temporada N" y, a la derecha de cada opción, sus episodios o "Vista".
export function SeasonPicker({
  options,
  selected,
  onSelect,
}: {
  options: SeasonOption[]
  selected: number
  onSelect: (n: number) => void
}) {
  return (
    <GlassMenu
      label={`Temporada ${selected}`}
      accessibilityLabel={`Temporada ${selected}. Cambiar temporada`}
      options={options.map((o) => ({
        key: String(o.number),
        label: `Temporada ${o.number}`,
        meta: o.done ? 'Vista' : `${o.episodes} ep.`,
      }))}
      selectedKey={String(selected)}
      onSelect={(k) => onSelect(Number(k))}
    />
  )
}
