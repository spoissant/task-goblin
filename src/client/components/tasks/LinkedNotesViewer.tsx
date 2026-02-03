import { useState } from "react";
import { useNavigate } from "react-router";
import { useNoteDetailQuery, useCreateNote } from "@/client/lib/queries/notes";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { StickyNote, Plus, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { LinkedNote } from "@/client/lib/types";

interface LinkedNotesViewerProps {
  taskId: number;
  taskTitle: string;
  jiraKey: string | null;
  notes: LinkedNote[];
}

export function LinkedNotesViewer({ taskId, taskTitle, jiraKey, notes }: LinkedNotesViewerProps) {
  const navigate = useNavigate();
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const createNote = useCreateNote();

  const { data: noteDetail } = useNoteDetailQuery(selectedNoteId ?? 0);
  const selectedNote = notes.find((n) => n.id === selectedNoteId);

  const handleNewNote = () => {
    createNote.mutate(
      { title: `Note for ${jiraKey || taskTitle}`, taskIds: [taskId] },
      {
        onSuccess: (note) => navigate(`/notes/${note.id}`),
        onError: () => toast.error("Failed to create note"),
      }
    );
  };

  const handleNoteClick = (noteId: number) => {
    setSelectedNoteId(noteId);
    setModalOpen(true);
  };

  const hasNotes = notes.length > 0;

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <StickyNote className="h-4 w-4" />
            Linked Notes
            {hasNotes && (
              <span className="text-sm font-normal text-muted-foreground">
                ({notes.length})
              </span>
            )}
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewNote}
            disabled={createNote.isPending}
          >
            <Plus className="h-4 w-4 mr-1" />
            New Note
          </Button>
        </CardHeader>
        <CardContent>
          {!hasNotes ? (
            <p className="text-muted-foreground text-sm text-center py-4">No linked notes</p>
          ) : (
            <table className="w-full">
              <tbody>
                {notes.map((note) => (
                  <tr
                    key={note.id}
                    className="cursor-pointer hover:bg-muted/50 transition-colors"
                    onClick={() => handleNoteClick(note.id)}
                  >
                    <td className="py-2 px-1 text-sm">{note.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <ModalDialog
        open={modalOpen}
        onOpenChange={setModalOpen}
        title={selectedNote?.title ?? "Note"}
        size="2xl"
        header={
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(`/notes/${selectedNoteId}`)}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Edit
          </Button>
        }
      >
        {noteDetail?.content ? (
          <div className="prose prose-sm dark:prose-invert max-w-none">
            <Markdown remarkPlugins={[remarkGfm]}>{noteDetail.content}</Markdown>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm italic">No content</p>
        )}
      </ModalDialog>
    </>
  );
}
