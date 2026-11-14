export type NativeContextMenuItem =
  | {
      type?: 'normal'
      id: string
      label: string
      enabled?: boolean
    }
  | {
      type: 'separator'
    }

export type NativeContextMenuRequest = {
  x?: number
  y?: number
  items: NativeContextMenuItem[]
}
