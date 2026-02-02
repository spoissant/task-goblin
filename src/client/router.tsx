import { createBrowserRouter } from "react-router";
import { RootLayout } from "./components/layout/RootLayout";
import { TasksPage } from "./pages/TasksPage";
import { TaskDetailPage } from "./pages/TaskDetailPage";
import { TodosPage } from "./pages/TodosPage";
import { CurationPage } from "./pages/CurationPage";
import { CompletedPage } from "./pages/CompletedPage";
import { LogsPage } from "./pages/LogsPage";
import { NotesPage } from "./pages/NotesPage";
import { NoteDetailPage } from "./pages/NoteDetailPage";
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
        path: "todos",
        element: <TodosPage />,
      },
      {
        path: "curate",
        element: <CurationPage />,
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
        path: "settings",
        element: <SettingsPage />,
      },
    ],
  },
]);
