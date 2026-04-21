import { createBrowserRouter } from "react-router";
import { RootLayout } from "./components/layout/RootLayout";
import { TasksPage } from "./pages/TasksPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { CompletedPage } from "./pages/CompletedPage";

import { ReviewsPage } from "./pages/ReviewsPage";
import { SettingsPage } from "./pages/SettingsPage";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <TasksPage />,
      },
      {
        path: "tasks/:id",
        element: <TaskDetailPage />,
      },
{
        path: "completed",
        element: <CompletedPage />,
      },
      {
        path: "reviews",
        element: <ReviewsPage />,
      },
      {
        path: "settings",
        element: <SettingsPage />,
      },
    ],
  },
]);
