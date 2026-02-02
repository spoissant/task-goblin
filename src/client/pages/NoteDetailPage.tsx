import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router";
import {
  useNoteDetailQuery,
  useUpdateNote,
  useDeleteNote,
  useLinkNoteTasks,
} from "@/client/lib/queries/notes";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Button } from "@/client/components/ui/button";
import { Badge } from "@/client/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { NoteForm } from "@/client/components/notes/NoteForm";
import { TaskLinker } from "@/client/components/notes/TaskLinker";
import { ArrowLeft, Trash2, Link as LinkIcon, ExternalLink } from "lucide-react";
import { toast } from "sonner";

export function NoteDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const noteId = parseInt(id || "0", 10);

  const { data: note, isLoading, error } = useNoteDetailQuery(noteId);
  const updateNote = useUpdateNote();
  const deleteNote = useDeleteNote();
  const linkTasks = useLinkNoteTasks();

  const [taskLinkerOpen, setTaskLinkerOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !note) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Note not found</p>
        <Button variant="ghost" onClick={() => navigate("/notes")} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Notes
        </Button>
      </div>
    );
  }

  const handleUpdate = (data: { title: string; content: string }) => {
    updateNote.mutate(
      { id: noteId, ...data },
      {
        onSuccess: () => toast.success("Note saved"),
        onError: () => toast.error("Failed to save note"),
      }
    );
  };

  const handleDelete = () => {
    if (confirm("Delete this note?")) {
      deleteNote.mutate(noteId, {
        onSuccess: () => {
          toast.success("Note deleted");
          navigate("/notes");
        },
        onError: () => toast.error("Failed to delete note"),
      });
    }
  };

  const handleLinkTasks = (taskIds: number[]) => {
    linkTasks.mutate(
      { noteId, taskIds },
      {
        onSuccess: () => {
          toast.success("Tasks linked");
          setTaskLinkerOpen(false);
        },
        onError: () => toast.error("Failed to link tasks"),
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => navigate("/notes")}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => setTaskLinkerOpen(true)}>
            <LinkIcon className="h-4 w-4 mr-2" />
            Link Tasks
          </Button>
          <Button variant="destructive" size="sm" onClick={handleDelete}>
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      </div>

      {/* Linked Tasks */}
      {note.tasks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Linked Tasks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {note.tasks.map((task) => (
                <Link key={task.id} to={`/tasks/${task.id}`}>
                  <Badge variant="secondary" className="hover:bg-accent cursor-pointer">
                    {task.jiraKey && (
                      <span className="font-mono mr-1">{task.jiraKey}</span>
                    )}
                    {task.title}
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Note Form */}
      <Card>
        <CardContent className="pt-6">
          <NoteForm
            initialTitle={note.title}
            initialContent={note.content || ""}
            onSubmit={handleUpdate}
            isSubmitting={updateNote.isPending}
            submitLabel="Save"
          />
        </CardContent>
      </Card>

      <TaskLinker
        open={taskLinkerOpen}
        onOpenChange={setTaskLinkerOpen}
        linkedTaskIds={note.tasks.map((t) => t.id)}
        onSave={handleLinkTasks}
        isSaving={linkTasks.isPending}
      />
    </div>
  );
}
