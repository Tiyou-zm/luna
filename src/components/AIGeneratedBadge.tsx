export function AIGeneratedBadge({tone = 'light'}: {tone?: 'light' | 'dark' | 'green'}) {
  const style = tone === 'dark'
    ? {background: 'rgba(255,255,255,0.14)', color: 'white', borderColor: 'rgba(255,255,255,0.32)'}
    : tone === 'green'
      ? {background: 'hsl(141 60% 45% / 0.12)', color: 'hsl(141 60% 30%)', borderColor: 'hsl(141 60% 45% / 0.22)'}
      : {background: 'hsl(243 67% 57% / 0.08)', color: 'hsl(243 67% 57%)', borderColor: 'hsl(243 67% 57% / 0.2)'}

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xl font-bold"
      style={style}
    >
      <span className="i-mdi-creation" style={{fontSize: '13px'}} />
      <span>人工智能生成</span>
    </span>
  )
}
