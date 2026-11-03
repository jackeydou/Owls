import { create } from 'zustand'
import type { AutoUpdateChannel } from '../../../shared/auto-update'
import type { DevAppInstanceInfo } from '../../../shared/dev-app-instance'
import type { PichuThinkingLevel } from '../../../shared/model-settings'
import { type AgentTrustProfile, normalizeAgentTrustProfile } from '../../../shared/tool-approval'

export type LanguageSetting = 'auto' | 'zh-CN' | 'en'
export type ProjectSortSetting = 'updated' | 'created' | 'name'

export type SettingsPayload = {
  model: string
  thinkingLevel: PichuThinkingLevel
  dataRoot: string
  workingDirectory: string
  enableAgentsSkills: boolean
  enableClaudeSkills: boolean
  computerUseEnabled: boolean
  debugMode: boolean
  language: LanguageSetting
  autoUpdateChannel: AutoUpdateChannel
  showInMenuBar: boolean
  showModelSwitcher: boolean
  followUpBehavior: 'queue' | 'steer'
  completionNotifications: 'never' | 'unfocused' | 'always'
  approvalNotifications: boolean
  questionNotifications: boolean
  themeMode: 'system' | 'light' | 'dark'
  modelTrajectoryLoggingEnabled: boolean
  modelTrajectoryLogDirectory: string
  automationKeepAwake: boolean
  projectSortKey: ProjectSortSetting
  agentTrustProfile: AgentTrustProfile
  devInstance: DevAppInstanceInfo | null
  devInstanceBadgeVisible: boolean
}

type SettingsSetResult = SettingsPayload | { restarting: true }

type SettingsState = {
  model: string
  thinkingLevel: PichuThinkingLevel
  dataRoot: string
  workingDirectory: string
  enableAgentsSkills: boolean
  enableClaudeSkills: boolean
  computerUseEnabled: boolean
  debugMode: boolean
  language: LanguageSetting
  autoUpdateChannel: AutoUpdateChannel
  showInMenuBar: boolean
  followUpBehavior: 'queue' | 'steer'
  completionNotifications: 'never' | 'unfocused' | 'always'
  approvalNotifications: boolean
  questionNotifications: boolean
  themeMode: 'system' | 'light' | 'dark'
  modelTrajectoryLoggingEnabled: boolean
  modelTrajectoryLogDirectory: string
  automationKeepAwake: boolean
  projectSortKey: ProjectSortSetting
  agentTrustProfile: AgentTrustProfile
  devInstance: DevAppInstanceInfo | null
  devInstanceBadgeVisible: boolean
  showModelSwitcher: boolean
  loaded: boolean
  error: string | null
  load: () => Promise<void>
  updateModel: (model: string) => Promise<void>
  updateThinkingLevel: (level: PichuThinkingLevel) => Promise<void>
  updateDataRoot: (path: string) => Promise<void>
  updateWorkingDirectory: (path: string) => Promise<void>
  updateEnableAgentsSkills: (enabled: boolean) => Promise<void>
  updateEnableClaudeSkills: (enabled: boolean) => Promise<void>
  updateLanguage: (language: LanguageSetting) => Promise<void>
  updateAutoUpdateChannel: (channel: AutoUpdateChannel) => Promise<void>
  updateShowInMenuBar: (enabled: boolean) => Promise<void>
  updateFollowUpBehavior: (behavior: 'queue' | 'steer') => Promise<void>
  updateCompletionNotifications: (value: 'never' | 'unfocused' | 'always') => Promise<void>
  updateApprovalNotifications: (enabled: boolean) => Promise<void>
  updateQuestionNotifications: (enabled: boolean) => Promise<void>
  updateThemeMode: (themeMode: 'system' | 'light' | 'dark') => Promise<void>
  updateModelTrajectoryLoggingEnabled: (enabled: boolean) => Promise<void>
  updateAutomationKeepAwake: (enabled: boolean) => Promise<void>
  updateProjectSortKey: (sortKey: ProjectSortSetting) => Promise<void>
  updateAgentTrustProfile: (profile: AgentTrustProfile) => Promise<void>
  updateDevInstanceBadgeVisible: (visible: boolean) => Promise<void>
  toggleDebugMode: () => Promise<void>
  applyPayload: (payload: SettingsPayload) => void
}

async function applySetting(
  patch: Parameters<typeof window.api.settings.set>[0],
  applyPayload: (p: SettingsPayload) => void
): Promise<void> {
  const res = (await window.api.settings.set(patch)) as SettingsSetResult
  if (!('restarting' in res)) {
    applyPayload(res)
  }
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  model: '',
  thinkingLevel: 'medium',
  dataRoot: '',
  workingDirectory: '',
  enableAgentsSkills: true,
  enableClaudeSkills: true,
  computerUseEnabled: false,
  debugMode: false,
  language: 'auto',
  autoUpdateChannel: 'stable',
  showInMenuBar: true,
  followUpBehavior: 'queue',
  completionNotifications: 'unfocused',
  approvalNotifications: true,
  questionNotifications: true,
  themeMode: 'system',
  modelTrajectoryLoggingEnabled: false,
  modelTrajectoryLogDirectory: '',
  automationKeepAwake: false,
  projectSortKey: 'name',
  agentTrustProfile: 'auto',
  devInstance: null,
  devInstanceBadgeVisible: false,
  showModelSwitcher: false,
  loaded: false,
  error: null,

  applyPayload: (payload) => {
    set({
      model: payload.model,
      thinkingLevel: payload.thinkingLevel,
      dataRoot: payload.dataRoot,
      workingDirectory: payload.workingDirectory,
      enableAgentsSkills: payload.enableAgentsSkills,
      enableClaudeSkills: payload.enableClaudeSkills,
      computerUseEnabled: payload.computerUseEnabled,
      debugMode: payload.debugMode,
      language: payload.language,
      autoUpdateChannel: payload.autoUpdateChannel,
      showInMenuBar: payload.showInMenuBar,
      showModelSwitcher: payload.showModelSwitcher,
      followUpBehavior: payload.followUpBehavior,
      completionNotifications: payload.completionNotifications,
      approvalNotifications: payload.approvalNotifications,
      questionNotifications: payload.questionNotifications,
      themeMode: payload.themeMode,
      modelTrajectoryLoggingEnabled: payload.modelTrajectoryLoggingEnabled,
      modelTrajectoryLogDirectory: payload.modelTrajectoryLogDirectory,
      automationKeepAwake: payload.automationKeepAwake,
      projectSortKey: payload.projectSortKey,
      agentTrustProfile: normalizeAgentTrustProfile(payload.agentTrustProfile),
      devInstance: payload.devInstance,
      devInstanceBadgeVisible: payload.devInstanceBadgeVisible
    })
  },

  load: async () => {
    set({ error: null })
    try {
      let payload = (await window.api.settings.get()) as SettingsPayload
      const legacyDebugMode = localStorage.getItem('pichu:debugMode')
      if (legacyDebugMode !== null) {
        const migratedDebugMode = legacyDebugMode === 'true'
        if (payload.debugMode !== migratedDebugMode) {
          const res = (await window.api.settings.set({
            debugMode: migratedDebugMode
          })) as SettingsSetResult
          if (!('restarting' in res)) {
            payload = res
          }
        }
        if (payload.debugMode === migratedDebugMode) {
          localStorage.removeItem('pichu:debugMode')
        }
      }

      localStorage.removeItem('pichu:showModelSwitcher')
      get().applyPayload(payload)
      set({ loaded: true })
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e), loaded: true })
    }
  },

  updateModel: (model) => applySetting({ model }, get().applyPayload),
  updateThinkingLevel: (thinkingLevel) => applySetting({ thinkingLevel }, get().applyPayload),
  updateDataRoot: (path) => applySetting({ dataRoot: path }, get().applyPayload),
  updateWorkingDirectory: (path) => applySetting({ workingDirectory: path }, get().applyPayload),
  updateEnableAgentsSkills: (enabled) =>
    applySetting({ enableAgentsSkills: enabled }, get().applyPayload),
  updateEnableClaudeSkills: (enabled) =>
    applySetting({ enableClaudeSkills: enabled }, get().applyPayload),
  updateLanguage: (language) => applySetting({ language }, get().applyPayload),
  updateAutoUpdateChannel: (autoUpdateChannel) =>
    applySetting({ autoUpdateChannel }, get().applyPayload),
  updateShowInMenuBar: (enabled) => applySetting({ showInMenuBar: enabled }, get().applyPayload),
  updateFollowUpBehavior: (behavior) =>
    applySetting({ followUpBehavior: behavior }, get().applyPayload),
  updateCompletionNotifications: (value) =>
    applySetting({ completionNotifications: value }, get().applyPayload),
  updateApprovalNotifications: (enabled) =>
    applySetting({ approvalNotifications: enabled }, get().applyPayload),
  updateQuestionNotifications: (enabled) =>
    applySetting({ questionNotifications: enabled }, get().applyPayload),
  updateThemeMode: (themeMode) => applySetting({ themeMode }, get().applyPayload),
  updateModelTrajectoryLoggingEnabled: (modelTrajectoryLoggingEnabled) =>
    applySetting({ modelTrajectoryLoggingEnabled }, get().applyPayload),
  updateAutomationKeepAwake: (automationKeepAwake) =>
    applySetting({ automationKeepAwake }, get().applyPayload),
  updateProjectSortKey: (projectSortKey) => applySetting({ projectSortKey }, get().applyPayload),
  updateAgentTrustProfile: (agentTrustProfile) =>
    applySetting({ agentTrustProfile }, get().applyPayload),
  updateDevInstanceBadgeVisible: (devInstanceBadgeVisible) =>
    applySetting({ devInstanceBadgeVisible }, get().applyPayload),

  toggleDebugMode: async () => {
    const next = !get().debugMode
    await applySetting({ debugMode: next }, get().applyPayload)
  }
}))
