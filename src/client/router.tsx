import { createBrowserRouter } from "react-router";
import { RootLayout } from "./components/layout/RootLayout";
import { TasksPage } from "./pages/TasksPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { CompletedPage } from "./pages/CompletedPage";
import { LogsPage } from "./pages/LogsPage";
import { NotesPage } from "./pages/NotesPage";
import { NoteDetailPage } from "./pages/NoteDetailPage";
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
        path: "logs",
        element: <LogsPage />,
      },
      {
        path: "notes",
        element: <NotesPage />,
      },
      {
        path: "notes/:id",
        element: <NoteDetailPage />,
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
