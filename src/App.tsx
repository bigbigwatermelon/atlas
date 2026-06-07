import { StoreProvider, useStore } from "./state/store";
import { WorkspaceNav } from "./nav/WorkspaceNav";
import { ThreadBoard } from "./board/ThreadBoard";
import { WorkspaceHome } from "./board/WorkspaceHome";
import { NeedsYouView } from "./board/NeedsYouView";
import { SessionView } from "./session/SessionView";

function Main() {
  const { activeSessionId, activeThreadId, showNeeds } = useStore();
  if (showNeeds) return <NeedsYouView />;
  if (activeSessionId != null) return <SessionView />;
  if (activeThreadId != null) return <ThreadBoard />;
  return <WorkspaceHome />;
}

export default function App() {
  return (
    <StoreProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-bg text-ink">
        <WorkspaceNav />
        <Main />
      </div>
    </StoreProvider>
  );
}
