import type { BadgeVariants } from '@/components/ui/badge'
import type { ModuleUsage } from '@/stores/modules'

/** Badge for a module's state, shared by the tile and the detail view. */
export const USAGE: Record<ModuleUsage, { label: string; variant: BadgeVariants['variant'] }> = {
  'in-use': { label: 'In Benutzung', variant: 'default' },
  ready: { label: 'Bereit', variant: 'secondary' },
  off: { label: 'Aus', variant: 'outline' }
}
