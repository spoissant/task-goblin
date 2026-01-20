import { createBrowserRouter } from "react-router";
import { RootLayout } from "./components/layout/RootLayout";
import { DashboardPage } from "./pages/DashboardPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { CurationPage } from "./pages/CurationPage";
import { SettingsPage } from "./pages/SettingsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: "tasks/:id",
        element: <TaskDetailPage />,
      },
      {
        path: "curate",
        element: <CurationPage />,
      },
      {
        path: "settings",
        element: <SettingsPage />,
      },
    ],
  },
]);
