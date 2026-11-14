import { create } from 'zustand'
import type { Failure, Reply } from '../../../shared/app'
import type {
  Board,
  BoardPlacement,
  BoardSave,
  Card,
  CardCapture,
  CardRef,
  CardSave
} from '../../../shared/cards'
import { UIError, uiFailure } from '../app/failures'

function unwrap<T>(reply: Reply<T>): T {
  if (!reply.ok) throw new UIError(reply.error)
  return reply.value
}

/** Which cards the library shows: cards are organized by their tags, not their project. */
export type CardFilter = { tag: string | null; query: string }
/** What the capture dialog is saving, and how it fills in the form. */
export type Capturing = {
  source: CardCapture['source']
  title: string
  preview: string
  projectId: string | null
}

type State = {
  status: 'idle' | 'loading' | 'ready' | 'failed'
  cards: Card[]
  boards: Board[]
  filter: CardFilter
  /** The board on screen; null shows the card list. */
  boardId: string | null
  /** The card open in the editor panel. */
  openCardId: string | null
  /** Bumps each time a card is opened, so the editor starts fresh; adopting a new card's id keeps it. */
  editorSession: number
  /** Cards picked to send, in the order they were picked. */
  selected: string[]
  capturing: Capturing | null
  /** True while the send dialog for `selected` is open. */
  choosingTarget: boolean
  /** Cards the next draft should start with, set when cards are sent to a thread. */
  pendingCards: CardRef[]
  error: Failure | null
  load(): Promise<void>
  setFilter(filter: Partial<CardFilter>): void
  showBoard(boardId: string | null): void
  openCard(cardId: string | null): void
  /** Points the open editor at the card it just created, without reopening it. */
  adoptCard(cardId: string): void
  toggleSelected(cardId: string): void
  setSelected(cardIds: string[]): void
  save(input: CardSave): Promise<Card | null>
  remove(cardId: string): Promise<boolean>
  startCapture(capturing: Capturing): void
  cancelCapture(): void
  capture(input: Omit<CardCapture, 'source'>): Promise<Card | null>
  saveBoard(input: BoardSave): Promise<Board | null>
  removeBoard(boardId: string): Promise<boolean>
  /** Moves cards on a board; the screen moves first and the save follows. */
  place(boardId: string, placements: BoardPlacement[]): Promise<void>
  chooseTarget(open: boolean): void
  /** Hands the picked cards to the next draft and clears the picks. */
  takeSelected(): CardRef[]
  setPending(cards: CardRef[]): void
  clearError(): void
}

/** Newer loads win, so a slow reply cannot overwrite what a later change brought. */
let generation = 0

export const useCardsStore = create<State>((set, get) => {
  async function action<T>(fn: () => Promise<Reply<T>>): Promise<T | null> {
    try {
      set({ error: null })
      return unwrap(await fn())
    } catch (error) {
      set({ error: uiFailure(error) })
      return null
    }
  }
  return {
    status: 'idle',
    cards: [],
    boards: [],
    filter: { tag: null, query: '' },
    boardId: null,
    openCardId: null,
    editorSession: 0,
    selected: [],
    capturing: null,
    choosingTarget: false,
    pendingCards: [],
    error: null,
    load: async () => {
      const mine = ++generation
      if (get().status === 'idle') set({ status: 'loading' })
      const reply = await window.owlto.cards.library()
      if (mine !== generation) return
      if (!reply.ok) {
        set({ status: 'failed', error: reply.error })
        return
      }
      const { cards, boards } = reply.value
      const live = new Set(cards.map((card) => card.id))
      set((state) => ({
        status: 'ready',
        cards,
        boards,
        selected: state.selected.filter((id) => live.has(id)),
        openCardId: state.openCardId && live.has(state.openCardId) ? state.openCardId : null,
        boardId:
          state.boardId && boards.some((board) => board.id === state.boardId) ? state.boardId : null
      }))
    },
    setFilter: (filter) => set((state) => ({ filter: { ...state.filter, ...filter } })),
    showBoard: (boardId) => set({ boardId }),
    openCard: (openCardId) =>
      set((state) => ({ openCardId, editorSession: state.editorSession + 1 })),
    adoptCard: (openCardId) => set({ openCardId }),
    toggleSelected: (cardId) =>
      set((state) => ({
        selected: state.selected.includes(cardId)
          ? state.selected.filter((id) => id !== cardId)
          : [...state.selected, cardId]
      })),
    setSelected: (selected) => set({ selected }),
    save: async (input) => {
      const card = await action(() => window.owlto.cards.save(input))
      if (card) await get().load()
      return card
    },
    remove: async (cardId) => {
      const done = (await action(() => window.owlto.cards.remove(cardId))) !== null
      if (done) await get().load()
      return done
    },
    startCapture: (capturing) => set({ capturing, error: null }),
    cancelCapture: () => set({ capturing: null }),
    capture: async (input) => {
      const capturing = get().capturing
      if (!capturing) return null
      const card = await action(() =>
        window.owlto.cards.capture({ ...input, source: capturing.source })
      )
      if (card) {
        set({ capturing: null })
        await get().load()
      }
      return card
    },
    saveBoard: async (input) => {
      const board = await action(() => window.owlto.cards.saveBoard(input))
      if (board) await get().load()
      return board
    },
    removeBoard: async (boardId) => {
      const done = (await action(() => window.owlto.cards.removeBoard(boardId))) !== null
      if (done) await get().load()
      return done
    },
    place: async (boardId, placements) => {
      set((state) => ({
        boards: state.boards.map((board) =>
          board.id === boardId ? { ...board, placements } : board
        )
      }))
      const saved = await action(() =>
        window.owlto.cards.saveBoard({ action: 'place', id: boardId, placements })
      )
      if (!saved) await get().load()
    },
    chooseTarget: (choosingTarget) => set({ choosingTarget }),
    takeSelected: () => {
      const { selected, cards } = get()
      const refs = selected.flatMap((id) => {
        const card = cards.find((c) => c.id === id)
        return card ? [{ id: card.id, title: card.title }] : []
      })
      set({ selected: [], choosingTarget: false })
      return refs
    },
    setPending: (pendingCards) => set({ pendingCards }),
    clearError: () => set({ error: null })
  }
})

/** Keeps the library current while the app runs. Returns the cleanup. */
export function watchCards(): () => void {
  void useCardsStore.getState().load()
  return window.owlto.cards.onChanged(() => void useCardsStore.getState().load())
}
