import { ipcRenderer } from 'electron'
import {
  BROWSER_ANNOTATION_HOST_COMMAND_CHANNEL,
  BROWSER_ANNOTATION_RUNTIME_EVENT_CHANNEL
} from '../shared/browser-annotation.js'
import { installBrowserAnnotationRuntime } from '../shared/browser-annotation-runtime.js'

const runtime = installBrowserAnnotationRuntime({
  postEvent: (event) => {
    ipcRenderer.send(BROWSER_ANNOTATION_RUNTIME_EVENT_CHANNEL, event)
  }
})

ipcRenderer.on(BROWSER_ANNOTATION_HOST_COMMAND_CHANNEL, (_event, command) => {
  runtime.handleCommand(command)
})
