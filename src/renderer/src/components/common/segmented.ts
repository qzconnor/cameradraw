/**
 * A ToggleGroup that looks like the tabs: a rounded pill, the picked option raised. Put
 * `SEGMENTED_GROUP` on the group (with `size="sm"` and `:spacing="0.5"`) and `SEGMENTED_ITEM` on
 * every item.
 */
export const SEGMENTED_GROUP = 'bg-muted p-0.75'

export const SEGMENTED_ITEM =
  'h-6.5 border border-transparent text-muted-foreground hover:bg-transparent hover:text-foreground data-[state=on]:border-input data-[state=on]:bg-input/30 data-[state=on]:text-foreground data-[state=on]:shadow-sm'
