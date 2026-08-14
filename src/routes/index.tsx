import { createFileRoute } from "@tanstack/react-router";
import { GloveFight } from "@/components/game/GloveFight";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return <GloveFight />;
}
