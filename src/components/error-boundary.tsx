import { Component, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props { children: ReactNode; label?: string; }
interface State { error: Error | null }

export class SectionErrorBoundary extends Component<Props, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }
  componentDidCatch(error: unknown) { console.error("[SectionErrorBoundary]", error); }
  reset = () => this.setState({ error: null });
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-6 space-y-3">
        <div className="flex items-center gap-2 font-semibold text-destructive">
          <AlertTriangle className="h-5 w-5" />
          No se pudo cargar {this.props.label ?? "esta sección"}
        </div>
        <pre className="text-xs whitespace-pre-wrap break-words text-muted-foreground max-h-48 overflow-auto bg-background/60 p-3 rounded-lg border">
          {this.state.error.message || String(this.state.error)}
        </pre>
        <Button size="sm" variant="outline" onClick={this.reset} className="gap-2">
          <RefreshCw className="h-4 w-4" /> Reintentar
        </Button>
      </div>
    );
  }
}
