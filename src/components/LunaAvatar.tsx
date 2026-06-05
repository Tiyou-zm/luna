interface LunaAvatarProps {
  size?: number
  iconSize?: number
}

export function LunaAvatar({size = 44, iconSize}: LunaAvatarProps) {
  const resolvedIconSize = iconSize ?? Math.round(size * 0.58)

  return (
    <div
      className="flex items-center justify-center"
      style={{
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: `${Math.max(10, Math.round(size * 0.28))}px`,
        background: 'linear-gradient(135deg, #38BDF8 0%, #6C5CE7 55%, #A29BFE 100%)',
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.45), 0 8px 18px rgba(35,42,89,0.22)'
      }}
    >
      <div className="i-mdi-robot-excited-outline text-white" style={{fontSize: `${resolvedIconSize}px`}} />
    </div>
  )
}
