"use client"

import React, { Component, ReactNode } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertCircle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: React.ErrorInfo | null
}

/**
 * Error Boundary for the Power Dialer component.
 * Catches rendering errors and displays a fallback UI instead of crashing the entire app.
 */
export class DialerErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[DialerErrorBoundary] Caught error:', error)
    console.error('[DialerErrorBoundary] Error info:', errorInfo)
    this.setState({ errorInfo })
    
    // Optionally report to error tracking service
    // reportError(error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <Card className="m-4 border-red-200 bg-red-50 dark:bg-red-900/20">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <AlertCircle className="h-5 w-5" />
              Power Dialer Error
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              Something went wrong with the Power Dialer. This may be due to unexpected data from the server.
            </p>
            
            {this.state.error && (
              <div className="p-3 bg-red-100 dark:bg-red-900/30 rounded text-xs font-mono text-red-700 dark:text-red-300 overflow-auto max-h-32">
                {this.state.error.message}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={this.handleReset}>
                <RefreshCw className="h-4 w-4 mr-1" />
                Try Again
              </Button>
              <Button variant="destructive" size="sm" onClick={this.handleReload}>
                Reload Page
              </Button>
            </div>

            <p className="text-xs text-gray-500">
              If this keeps happening, please contact support with the error details above.
            </p>
          </CardContent>
        </Card>
      )
    }

    return this.props.children
  }
}

export default DialerErrorBoundary

