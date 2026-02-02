import { useState } from "react";
import { useNavigate } from "react-router";
import { useNoteDetailQuery, useCreateNote } from "@/client/lib/queries/notes";
import { Card, CardContent, CardHeader, CardTitle } from "@/client/components/ui/card";
import { Button } from "@/client/components/ui/button";
import { StickyNote, ChevronLeft, ChevronRight, Plus, ExternalLink } from "lucide-react";
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
  const [currentIndex, setCurrentIndex] = useState(0);
  const createNote = useCreateNote();

  const currentNoteId = notes[currentIndex]?.id;
  const { data: noteDetail } = useNoteDetailQuery(currentNoteId ?? 0);

  const handleNewNote = () => {
    createNote.mutate(
      { title: `Note for ${jiraKey || taskTitle}`, taskIds: [taskId] },
      {
        onSuccess: (note) => navigate(`/notes/${note.id}`),
        onError: () => toast.error("Failed to create note"),
      }
    );
  };

  const hasNotes = notes.length > 0;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < notes.length - 1;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <StickyNote className="h-4 w-4" />
          Linked Notes
          {hasNotes && (
            <span className="text-sm font-normal text-muted-foreground">
              ({currentIndex + 1} of {notes.length})
            </span>
          )}
        </CardTitle>
        <div className="flex items-center gap-2">
          {hasNotes && (
            <>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentIndex((i) => i - 1)}
                disabled={!canGoPrev}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => setCurrentIndex((i) => i + 1)}
                disabled={!canGoNext}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleNewNote}
            disabled={createNote.isPending}
          >
            <Plus className="h-4 w-4 mr-1" />
            New Note
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {!hasNotes ? (
          <p className="text-muted-foreground text-sm text-center py-4">No linked notes</p>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{notes[currentIndex].title}</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/notes/${currentNoteId}`)}
              >
                <ExternalLink className="h-4 w-4 mr-1" />
                Edit
              </Button>
            </div>
            {noteDetail?.content ? (
              <div className="prose prose-sm dark:prose-invert max-w-none">
                <Markdown remarkPlugins={[remarkGfm]}>{noteDetail.content}</Markdown>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm italic">No content</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
