import { Link } from "react-router";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/client/components/ui/table";
import { Button } from "@/client/components/ui/button";
import { EmptyState } from "@/client/components/ui/empty-state";
import { Trash2 } from "lucide-react";
import type { Note } from "@/client/lib/types";

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

interface NoteTableProps {
  notes: Note[];
  onDelete: (id: number) => void;
  isDeleting?: boolean;
}

export function NoteTable({ notes, onDelete, isDeleting }: NoteTableProps) {
  if (notes.length === 0) {
    return <EmptyState message="No notes found" />;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Title</TableHead>
          <TableHead className="w-[120px]">Created</TableHead>
          <TableHead className="w-[120px]">Updated</TableHead>
          <TableHead className="w-[60px]"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {notes.map((note) => (
          <TableRow key={note.id}>
            <TableCell>
              <Link
                to={`/notes/${note.id}`}
                className="text-foreground hover:underline font-medium"
              >
                {note.title}
              </Link>
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDate(note.createdAt)}
            </TableCell>
            <TableCell className="text-muted-foreground">
              {formatDate(note.updatedAt)}
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => onDelete(note.id)}
                disabled={isDeleting}
              >
                <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
