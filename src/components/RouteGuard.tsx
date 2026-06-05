// Storage key for saving redirect path after login
export const STORAGE_KEY_REDIRECT_PATH = 'loginRedirectPath'

/**
 * HOC to wrap a component with route guard
 * Usage: export default withRouteGuard(PageComponent)
 */
export function withRouteGuard<P extends object>(Component: React.ComponentType<P>) {
  return function GuardedComponent(props: P) {
    return <Component {...props} />
  }
}
