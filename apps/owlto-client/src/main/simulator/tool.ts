import { z } from 'zod'
import { simulatorButtonSchema } from '../../shared/simulator.js'
import type { ReportToolResult } from '../router/report.js'
import { asyncWorkerTool, type WorkerTool } from '../router/worker-tools.js'
import type { SimulatorService, TapTarget } from './service.js'

/** The service calls a worker's tools make; `key` is the worker's id. */
export type WorkerSimulator = Pick<
  SimulatorService,
  | 'listForWorker'
  | 'attachForWorker'
  | 'install'
  | 'launch'
  | 'openUrl'
  | 'screen'
  | 'tap'
  | 'swipe'
  | 'type'
  | 'button'
  | 'logs'
>

const point = z.object({
  x: z.number().finite().min(0).describe('Points from the left edge of the screen.'),
  y: z.number().finite().min(0).describe('Points from the top edge of the screen.')
})
const device = z
  .string()
  .min(1)
  .max(200)
  .optional()
  .describe(
    'A device name such as "iPhone 17 Pro", or its UDID. Leave out to use the one already showing.'
  )
const args = z.array(z.string().max(1_000)).max(50).optional().describe('Launch arguments.')
const ref = z
  .string()
  .regex(/^@e\d+$/)
  .describe('An element ref from your last simulator_screen, such as @e3.')

const ok = async (run: Promise<string>): Promise<ReportToolResult> => ({
  ok: true,
  text: await run
})

/**
 * The `simulator_*` tools for one worker: it holds one simulated device at a time, shown live
 * in the user's iOS Simulator panel. Sorted by name, like every worker tool list.
 */
export function simulatorTools(simulator: WorkerSimulator, key: string): WorkerTool[] {
  return [
    asyncWorkerTool(
      'simulator_attach',
      'Take an iOS simulator for testing an app: boots it if needed and shows it in the user’s Simulator panel. The first time you use a device the user is asked to allow it. You hold one device at a time; call this before the other simulator_* tools.',
      z.object({ device }),
      (input) => ok(simulator.attachForWorker(key, input.device))
    ),
    asyncWorkerTool(
      'simulator_button',
      'Press a hardware button on your simulator: home, lock, app_switcher, or siri.',
      z.object({ name: simulatorButtonSchema }),
      (input) => ok(simulator.button(key, input.name))
    ),
    asyncWorkerTool(
      'simulator_devices',
      'List the iOS simulators on this Mac, with their state and whether another worker is using one.',
      z.object({}),
      () => ok(simulator.listForWorker(key))
    ),
    asyncWorkerTool(
      'simulator_install',
      'Install an app you built for the iOS Simulator (the .app folder, for example from xcodebuild -destination "platform=iOS Simulator,…" under DerivedData) on your simulator, and launch it unless launch is false. Unless you have full access, the user approves it first.',
      z.object({
        appPath: z.string().min(1).max(4_096).describe('Absolute path of the .app bundle.'),
        launch: z.boolean().optional().describe('Launch it after installing. Default true.'),
        args
      }),
      (input) => ok(simulator.install(key, input.appPath, input.launch ?? true, input.args ?? []))
    ),
    asyncWorkerTool(
      'simulator_launch',
      'Launch an installed app on your simulator by bundle id, restarting it if it runs. Unless you have full access, the user approves apps you did not install.',
      z.object({
        bundleId: z.string().min(1).max(255),
        args,
        terminateFirst: z.boolean().optional().describe('Quit a running copy first. Default true.')
      }),
      (input) =>
        ok(simulator.launch(key, input.bundleId, input.args ?? [], input.terminateFirst ?? true))
    ),
    asyncWorkerTool(
      'simulator_logs',
      'Read recent log lines from your simulator, from one app you installed or from the whole device.',
      z.object({
        bundleId: z
          .string()
          .min(1)
          .max(255)
          .optional()
          .describe('An app you installed with simulator_install.'),
        seconds: z
          .number()
          .int()
          .min(1)
          .max(600)
          .optional()
          .describe('How far back to read. Default 60.'),
        limit: z
          .number()
          .int()
          .min(1)
          .max(500)
          .optional()
          .describe('Most recent lines to return. Default 200.')
      }),
      (input) => ok(simulator.logs(key, input.bundleId, input.seconds ?? 60, input.limit ?? 200))
    ),
    asyncWorkerTool(
      'simulator_open_url',
      'Open a URL on your simulator, such as a deep link into your app or a page in Safari. Unless you have full access, the user approves it first.',
      z.object({ url: z.string().min(1).max(8_192) }),
      (input) => ok(simulator.openUrl(key, input.url))
    ),
    asyncWorkerTool(
      'simulator_screen',
      'Look at your simulator: the screen size in points, one line per element with text or input (with a ref such as @e3 and its center point), and a screenshot file. Use it to check your change, and again after each tap or swipe.',
      z.object({
        tree: z.boolean().optional().describe('Include the element list. Default true.'),
        image: z
          .boolean()
          .optional()
          .describe('Save a screenshot and return its path. Default true.')
      }),
      (input) => ok(simulator.screen(key, input.tree ?? true, input.image ?? true))
    ),
    asyncWorkerTool(
      'simulator_swipe',
      'Swipe on your simulator from one point to another, in points. Scroll down by swiping up.',
      z.object({
        from: point,
        to: point,
        durationMs: z.number().int().min(50).max(5_000).optional().describe('Default 300.')
      }),
      (input) => ok(simulator.swipe(key, input.from, input.to, input.durationMs ?? 300))
    ),
    asyncWorkerTool(
      'simulator_tap',
      'Tap on your simulator: an element by its ref from simulator_screen (preferred), or a point in points. A longer durationMs long-presses.',
      z.object({
        ref: ref.optional(),
        x: z.number().finite().min(0).optional(),
        y: z.number().finite().min(0).optional(),
        durationMs: z.number().int().min(40).max(5_000).optional().describe('Default 60.')
      }),
      (input) => {
        let target: TapTarget
        if (input.ref) target = { ref: input.ref }
        else if (input.x !== undefined && input.y !== undefined) target = { x: input.x, y: input.y }
        else return Promise.resolve({ ok: false, text: 'Give a ref, or both x and y.' })
        return ok(simulator.tap(key, target, input.durationMs ?? 60))
      }
    ),
    asyncWorkerTool(
      'simulator_type',
      'Type text into the focused field on your simulator; tap the field first. Text a US keyboard cannot type, such as Chinese or emoji, is pasted.',
      z.object({
        text: z.string().min(1).max(2_000),
        submit: z.boolean().optional().describe('Press Return after typing. Default false.')
      }),
      (input) => ok(simulator.type(key, input.text, input.submit ?? false))
    )
  ]
}
