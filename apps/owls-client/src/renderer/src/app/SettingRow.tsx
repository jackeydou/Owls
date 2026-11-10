import type { ReactNode } from 'react'

/**
 * A setting's name and explanation on the left, its control on the right. `detail` holds what
 * needs the full width underneath, such as a path. `htmlFor` ties the name to a single control;
 * `labelId` lets a group of controls name itself with it instead.
 */
export function SettingRow({
  label,
  description,
  htmlFor,
  labelId,
  detail,
  children
}: {
  label: ReactNode
  description?: ReactNode
  htmlFor?: string
  labelId?: string
  detail?: ReactNode
  children?: ReactNode
}) {
  return (
    <div className="owls-setting-row">
      <div className="owls-setting-text">
        {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <h3 id={labelId}>{label}</h3>}
        {description ? <p>{description}</p> : null}
      </div>
      {children}
      {detail ? <div className="owls-setting-detail">{detail}</div> : null}
    </div>
  )
}
