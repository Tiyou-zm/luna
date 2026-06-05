/**
 * @file Taro application entry file
 */

import type React from 'react'
import type {PropsWithChildren} from 'react'
import {useTabBarPageClass} from '@/hooks/useTabBarPageClass'
import {AppErrorBoundary} from '@/components/AppErrorBoundary'
import {AuthProvider} from '@/contexts/AuthContext'
import {initRuntimeDiagnostics} from '@/utils/runtimeDiagnostics'

import './app.scss'

initRuntimeDiagnostics()

const App: React.FC = ({children}: PropsWithChildren<unknown>) => {
  useTabBarPageClass()

  return (
    <AppErrorBoundary>
      <AuthProvider>{children}</AuthProvider>
    </AppErrorBoundary>
  )
}

export default App
