import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = {
  /** names the region in the fallback, e.g. "Source" */
  label: string;
  /** when this changes the pane is allowed to try again (e.g. a new trace) */
  resetKey?: unknown;
  children: ReactNode;
};

type State = { error: Error | null };

/**
 * A crash inside one pane (a bad scene, a broken save, an editor bug) should
 * cost you that pane, not the whole session. The fallback keeps the rest of the
 * lab usable and offers a one-click retry.
 */
export class PaneBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // keep the detail in the console for whoever is debugging the failure
    console.error(`[${this.props.label}] pane crashed`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="pane-crash" role="alert">
        <b>{this.props.label} hit a problem</b>
        <span>{this.state.error.message}</span>
        <button className="ghost-action" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
