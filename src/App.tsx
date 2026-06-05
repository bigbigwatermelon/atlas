import { StoreProvider } from "./state/store";
import { WorkspaceNav } from "./nav/WorkspaceNav";
import { SessionView } from "./session/SessionView";

export default function App() {
  return (
    <StoreProvider>
      <div className="flex h-screen w-screen overflow-hidden bg-bg text-ink">
        <WorkspaceNav />
        <SessionView />
      </div>
    </StoreProvider>
  );
}
