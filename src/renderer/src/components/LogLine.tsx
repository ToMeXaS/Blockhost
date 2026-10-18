import { memo } from 'react'
import { LEVEL_TEXT, type ParsedLine } from '../lib/logLevel'

/** One console line: the level prefix in the level's colour, the message after it. */
export const LogLine = memo(function LogLine({
  text,
  level,
  tagEnd
}: ParsedLine & { text: string }) {
  if (tagEnd === 0) {
    return <div className={`whitespace-pre-wrap break-all ${LEVEL_TEXT[level]}`}>{text}</div>
  }
  return (
    <div className="whitespace-pre-wrap break-all">
      <span className={LEVEL_TEXT[level]}>{text.slice(0, tagEnd)}</span>
      <span className={level === 'chat' ? 'text-text' : 'text-text-2'}>{text.slice(tagEnd)}</span>
    </div>
  )
})
