import { Component, type ErrorInfo, type ReactNode } from "react";

/** 共享工作台是整页替换；渲染异常必须显示原因，不能只留白屏。 */
export class WorkspaceBoundary extends Component<{ children: ReactNode }, { message: string }> {
  state = { message: "" };

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ message: `${error.message}\n${info.componentStack ?? ""}` });
  }

  render() {
    if (this.state.message) {
      return (
        <div role="alert" className="preview-error" style={{ margin: 16, whiteSpace: "pre-wrap" }}>
          共享工作台加载失败：{this.state.message}
          <button type="button" style={{ marginLeft: 12 }} onClick={() => this.setState({ message: "" })}>重试</button>
        </div>
      );
    }
    return this.props.children;
  }
}