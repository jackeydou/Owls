// The sandboxed preload imports this file, so it must not import packages: a sandboxed
// preload can only `require('electron')`, and any other import blanks the window.

/** The IPC channel and `window` message the preload uses to hand a stream port to the page. */
export const SIMULATOR_STREAM_MESSAGE = 'owlto:simulator-stream'
export type SimulatorStreamEnvelope = { type: typeof SIMULATOR_STREAM_MESSAGE; udid: string }
