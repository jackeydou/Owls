import { code } from '@streamdown/code'
import { memo } from 'react'
import { Streamdown } from 'streamdown'

const plugins = { code }

/** A card's Markdown, rendered. On tiles and boards it is read-only and clipped by CSS. */
export const CardBody = memo(function CardBody({ body }: { body: string }) {
  return (
    <div className="owls-markdown card-body">
      <Streamdown plugins={plugins} controls={false}>
        {body}
      </Streamdown>
    </div>
  )
})
