interface SliderSwitchProps {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  disabled?: boolean
}

/**
 * 滑动开关（iOS 风格）：轨道 + 圆点平移。
 * 触控目标 ≥ 40×22（点击热区扩到 44×28），seal 色激活态，
 * 过渡 0.18s，prefers-reduced-motion 时关闭。
 */
export default function SliderSwitch({ checked, onChange, label, disabled }: SliderSwitchProps) {
  return (
    <button
      type="button"
      className={'slider-switch' + (checked ? ' on' : '') + (disabled ? ' disabled' : '')}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="knob" aria-hidden="true" />
    </button>
  )
}
