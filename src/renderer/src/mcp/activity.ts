/**
 * What an MCP client is doing, in words for the title bar: "Claude Code zeichnet …". Tools not
 * listed (e.g. new ones) are just "arbeitet".
 */
const ACTIVITIES: Record<string, string> = {
  get_state: 'schaut sich um',
  screenshot: 'schaut aufs Fenster',
  press_key: 'drückt Tasten',
  click: 'klickt',
  drag: 'zieht mit der Maus',
  type_text: 'tippt',
  show_panel: 'öffnet ein Fenster',
  update_settings: 'ändert Einstellungen',
  list_cameras: 'sucht Kameras',
  select_camera: 'wechselt die Kamera',
  set_camera: 'stellt die Kamera ein',
  capture: 'nimmt ein Bild auf',
  set_burst: 'stellt die Serienaufnahme ein',
  list_fonts: 'sucht Schriften',
  list_library: 'blättert in der Galerie',
  get_image: 'sieht sich ein Bild an',
  open_image: 'öffnet ein Bild',
  create_project: 'legt ein Projekt an',
  rename_project: 'benennt ein Projekt um',
  delete_project: 'löscht ein Projekt',
  rename_image: 'benennt ein Bild um',
  move_image: 'verschiebt ein Bild',
  delete_image: 'löscht ein Bild',
  copy_image: 'kopiert ein Bild',
  editor_state: 'liest den Editor',
  editor_image: 'betrachtet das Bild',
  editor_draw: 'zeichnet',
  editor_layers: 'ordnet Ebenen',
  editor_insert_image: 'fügt ein Bild ein',
  editor_select: 'wählt aus',
  editor_update: 'ändert Objekte',
  editor_delete: 'löscht Objekte',
  editor_arrange: 'ordnet Objekte an',
  editor_clipboard: 'kopiert und fügt ein',
  editor_history: 'blättert im Verlauf',
  editor_set_tool: 'wählt ein Werkzeug',
  editor_set_view: 'zoomt',
  editor_set_scale: 'setzt den Maßstab',
  editor_rotate: 'dreht das Bild',
  editor_perspective: 'schneidet zu',
  editor_extend: 'fügt Fläche an',
  editor_reset_image: 'setzt das Bild zurück',
  editor_save: 'speichert',
  editor_copy_image: 'kopiert das Bild',
  editor_close: 'schließt den Editor'
}

export const activityOf = (tool: string | null | undefined): string =>
  (tool && ACTIVITIES[tool]) || 'arbeitet'

/** The client's name as it introduced itself – `claude-code` reads as "Claude Code". */
export function clientLabel(name: string | null | undefined): string {
  const trimmed = name?.trim()
  if (!trimmed) return 'KI'
  if (/[A-Z ]/.test(trimmed)) return trimmed
  return trimmed
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}
