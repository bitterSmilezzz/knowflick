import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "32px", color: "var(--fg, #111)", background: "var(--bg, #fafafa)", minHeight: "100vh" }}>
          <h2 style={{ fontSize: "1.25rem", color: "#e11d48", marginBottom: "8px" }}>工作台遇到了意外错误</h2>
          <p style={{ color: "#666", fontSize: "0.9rem", marginBottom: "16px" }}>
            {this.state.error?.message || "未知渲染错误"}
          </p>
          <button
            type="button"
            style={{
              padding: "8px 16px",
              background: "#2563eb",
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 500,
            }}
            onClick={() => {
              this.setState({ hasError: false, error: null });
              window.location.reload();
            }}
          >
            刷新工作台
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
