import { useState } from "react";
import { useNavigate } from "react-router";
import { useNotesQuery, useCreateNote, useDeleteNote } from "@/client/lib/queries/notes";
import { Skeleton } from "@/client/components/ui/skeleton";
import { Button } from "@/client/components/ui/button";
import { Input } from "@/client/components/ui/input";
import { Pagination } from "@/client/components/ui/pagination";
import { ModalDialog } from "@/client/components/ui/modal-dialog";
import { NoteTable } from "@/client/components/notes/NoteTable";
import { NoteForm } from "@/client/components/notes/NoteForm";
import { EmptyState } from "@/client/components/ui/empty-state";
import { Plus, Search } from "lucide-react";

const PAGE_SIZE = 25;

export function NotesPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  const { data, isLoading, error } = useNotesQuery({
    q: debouncedQuery || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });

  const createNote = useCreateNote();
  const deleteNote = useDeleteNote();

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  // Simple debounce for search
  const handleSearchChange = (value: string) => {
    setSearchQuery(value);
    setPage(0);
    // Debounce the actual query
    const timer = setTimeout(() => {
      setDebouncedQuery(value);
    }, 300);
    return () => clearTimeout(timer);
  };

  const handleCreate = (formData: { title: string; content: string }) => {
    createNote.mutate(
      { title: formData.title, content: formData.content },
      {
        onSuccess: (note) => {
          setCreateDialogOpen(false);
          navigate(`/notes/${note.id}`);
        },
      }
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Delete this note?")) {
      deleteNote.mutate(id);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Notes</h1>
        <Button onClick={() => setCreateDialogOpen(true)}>
          <Plus className="h-4 w-4 mr-2" />
          New Note
        </Button>
        <ModalDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          title="Create Note"
          size="lg"
        >
          <NoteForm
            onSubmit={handleCreate}
            onCancel={() => setCreateDialogOpen(false)}
            isSubmitting={createNote.isPending}
            submitLabel="Create"
          />
        </ModalDialog>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search notes..."
          value={searchQuery}
          onChange={(e) => handleSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {error && <EmptyState message="Failed to load notes" />}

      {data && (
        <>
          <NoteTable
            notes={data.items}
            onDelete={handleDelete}
            isDeleting={deleteNote.isPending}
          />
          {totalPages > 1 && (
            <Pagination
              page={page}
              totalPages={totalPages}
              onPageChange={setPage}
              className="mt-6"
            />
          )}
        </>
      )}
    </div>
  );
}
