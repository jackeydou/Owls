import { useMemo } from 'react'
import { messageParts } from './quotes'
import './quotes.css'

/** A user's message in the thread, with the passages it quotes set off as quotes. */
export function UserText({ text }: { text: string }) {
  const parts = useMemo(() => messageParts(text), [text])
  if (!parts.some((part) => part.kind === 'quote'))
    return <div className="owlto-user-message">{text}</div>
  return (
    <div className="owlto-user-message">
      {parts.map((part, index) =>
        part.kind === 'quote' ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are fixed for a given message.
          <blockquote key={index} className="router-message-quote">
            {part.text}
          </blockquote>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are fixed for a given message.
          <p key={index}>{part.text}</p>
        )
      )}
    </div>
  )
}
