import {Component, type ErrorInfo, type ReactNode} from 'react'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

export class AppErrorBoundary extends Component<Props, State> {
  state: State = {error: null}

  static getDerivedStateFromError(error: Error): State {
    return {error}
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('App render failed:', error, info)
  }

  render() {
    if (!this.state.error) return this.props.children

    return (
      <div style={{padding: '24px', color: '#111827', background: '#fff'}}>
        <div style={{fontSize: '18px', fontWeight: 700, marginBottom: '12px'}}>页面运行异常</div>
        <div style={{fontSize: '14px', lineHeight: 1.6, whiteSpace: 'pre-wrap'}}>
          {this.state.error.message || String(this.state.error)}
        </div>
      </div>
    )
  }
}
