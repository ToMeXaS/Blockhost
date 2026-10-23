import { memo } from 'react'
import { LEVEL_LABEL, LEVEL_TEXT, logTime, type ParsedLine } from '../lib/logLevel'

/** One console line in columns: time, level, then the message after the prefix. */
export const LogLine = memo(function LogLine({
  text,
  level,
  tagEnd
}: ParsedLine & { text: string }) {
  const tagged = tagEnd > 0
  return (
    <div className="flex gap-3">
      <span className="w-[8ch] shrink-0 text-faint">{tagged ? logTime(text, tagEnd) : null}</span>
      <span className={`w-[5ch] shrink-0 font-semibold ${LEVEL_TEXT[level]}`}>
        {tagged ? LEVEL_LABEL[level] : null}
      </span>
      <span
        className={`min-w-0 flex-1 whitespace-pre-wrap break-words ${tagged ? 'text-text' : LEVEL_TEXT[level]}`}
      >
        {tagged ? text.slice(tagEnd) : text}
      </span>
    </div>
  )
})
