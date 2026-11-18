import { code } from '@streamdown/code'
import { memo } from 'react'
import { Streamdown } from 'streamdown'
import { markdownLinkComponents } from '../app/MarkdownLink'
import { mermaidRenderer } from '../app/MermaidDiagram'
import { markdownRemarkPlugins } from '../files/remark-file-links'

const plugins = { code, renderers: [mermaidRenderer] }

/** A card's Markdown, rendered. On tiles and boards it is read-only and clipped by CSS. */
export const CardBody = memo(function CardBody({ body }: { body: string }) {
  return (
    <div className="owlto-markdown card-body">
      <Streamdown
        plugins={plugins}
        controls={false}
        components={markdownLinkComponents}
        remarkPlugins={markdownRemarkPlugins}
      >
        {body}
      </Streamdown>
    </div>
  )
})
