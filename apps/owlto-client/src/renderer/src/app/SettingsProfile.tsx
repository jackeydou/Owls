import { ActionButton } from '@renderer/components/ui/action-button'
import { Button } from '@renderer/components/ui/button'
import { GitPullRequestIcon, UploadIcon } from '@renderer/components/ui/icons'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  PROFILE_AVATAR_IMAGE_LIMIT,
  PROFILE_AVATAR_SIZE,
  PROFILE_NAME_LIMIT
} from '../../../shared/profile'
import { DraftText } from './DraftText'
import { SettingRow } from './SettingRow'
import { squareImageFromFile } from './square-image'
import { useAppStore } from './store'
import { UserAvatar } from './UserAvatar'

/** The avatar row: the current picture, and ways to upload one, take GitHub's, or go back. */
function AvatarSetting() {
  const { t } = useTranslation()
  const labelId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [failed, setFailed] = useState(false)
  const avatar = useAppStore((s) => s.settings.profile.avatar)
  const gitHubConnected = useAppStore((s) => s.github.status === 'signed-in')
  const saveProfile = useAppStore((s) => s.saveProfile)
  const applyGitHubAvatar = useAppStore((s) => s.applyGitHubAvatar)
  return (
    <SettingRow
      label={t('profile.avatar')}
      labelId={labelId}
      description={t('profile.avatarHelp')}
      detail={
        <div className="owlto-profile-avatar">
          <UserAvatar className="owlto-profile-avatar-preview" />
          <div className="owlto-profile-avatar-body">
            <div className="owlto-settings-actions">
              <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()}>
                <UploadIcon size={16} />
                {t('profile.upload')}
              </Button>
              {gitHubConnected && avatar.kind !== 'github' ? (
                <ActionButton
                  size="sm"
                  variant="ghost"
                  icon={<GitPullRequestIcon size={16} />}
                  // The preview changes on success; a failure shows as a toast.
                  onAction={async () => void (await applyGitHubAvatar())}
                >
                  {t('profile.useGitHub')}
                </ActionButton>
              ) : null}
              {avatar.kind === 'owl' ? null : (
                <ActionButton
                  size="sm"
                  variant="ghost"
                  onAction={async () => void (await saveProfile({ avatar: { kind: 'owl' } }))}
                >
                  {t('profile.reset')}
                </ActionButton>
              )}
            </div>
            {avatar.kind === 'github' ? (
              <small>{t('profile.avatarFromGitHub', { login: avatar.login })}</small>
            ) : null}
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              setFailed(false)
              squareImageFromFile(file, PROFILE_AVATAR_SIZE, PROFILE_AVATAR_IMAGE_LIMIT).then(
                (src) => void saveProfile({ avatar: { kind: 'upload', src } }),
                () => setFailed(true)
              )
            }}
          />
          {failed ? (
            <p className="owlto-project-icon-error" role="alert">
              {t('profile.uploadFailed')}
            </p>
          ) : null}
        </div>
      }
    />
  )
}

export function ProfileSettingsPane() {
  const { t } = useTranslation()
  const name = useAppStore((s) => s.settings.profile.name)
  const saveProfile = useAppStore((s) => s.saveProfile)
  return (
    <section className="owlto-settings-section">
      <h2>{t('profile.title')}</h2>
      <SettingRow
        label={t('profile.name')}
        htmlFor="owlto-profile-name"
        description={t('profile.nameHelp')}
      >
        <DraftText
          id="owlto-profile-name"
          single
          className="router-input"
          maxLength={PROFILE_NAME_LIMIT}
          placeholder={t('profile.namePlaceholder')}
          value={name ?? ''}
          onCommit={(next) => void saveProfile({ name: next })}
        />
      </SettingRow>
      <AvatarSetting />
    </section>
  )
}
