import React, { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  handleRetry = (): void => {
    (this as React.Component<Props, State>).setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    const { state, props } = this as React.Component<Props, State>;
    if (state.hasError && state.error) {
      if (props.fallback) {
        return props.fallback;
      }
      return (
        <div className="max-w-md mx-auto min-h-screen bg-[#fcfcf9] flex flex-col items-center justify-center px-6">
          <div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mb-6">
            <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-stone-800 text-center mb-2">Something went wrong</h1>
          <p className="text-stone-500 text-sm text-center mb-6 max-w-sm">
            {state.error.message}
          </p>
          <button
            onClick={this.handleRetry}
            className="px-6 py-3 bg-emerald-600 text-white font-semibold rounded-2xl hover:bg-emerald-700 active:scale-[0.98] transition-all"
          >
            Try again
          </button>
        </div>
      );
    }
    return props.children;
  }
}

export default ErrorBoundary;
