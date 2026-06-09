import { StoreProvider, useStore } from "./state/store";
import { WorkspaceNav } from "./nav/WorkspaceNav";
import { ThreadBoard } from "./board/ThreadBoard";
import { WorkspaceHome } from "./board/WorkspaceHome";
import { SessionView } from "./session/SessionView";
import { ObserveView } from "./session/ObserveView";
import { DangerToast } from "./components/DangerToast";

function Main() {
  const { activeSessionId, viewing, activeThreadId } = useStore();
  if (activeSessionId != null) return <SessionView />;
  if (viewing != null) return <ObserveView />;
  if (activeThreadId != null) return <ThreadBoard />;
  return <WorkspaceHome />;
}

function Shell() {
  const { navCollapsed } = useStore();
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-bg text-ink">
      {!navCollapsed && <WorkspaceNav />}
      <Main />
      <DangerToast />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
