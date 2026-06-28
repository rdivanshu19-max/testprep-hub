import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/extraction")({
  head: () => ({ meta: [{ title: "PDF → CBT — Admin" }] }),
  component: () => <Outlet />,
});
